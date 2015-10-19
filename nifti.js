"use strict"
var assert = require('assert')

var systemEndianness = (function() {
    var buf = new ArrayBuffer(4),
        intArr = new Uint32Array(buf),
        byteArr = new Uint8Array(buf)
    intArr[0] = 0x01020304
    if (byteArr[0]==1 && byteArr[1]==2 && byteArr[2]==3 && byteArr[3]==4) {
        return 'big'
    } else if (byteArr[0]==4 && byteArr[1]==3 && byteArr[2]==2 && byteArr[3]==1) {
        return 'little'
    }
    console.warn("Unrecognized system endianness!")
    return undefined
})()

// This expects an ArrayBuffer or (Node.js) Buffer
module.exports.parse = function (buffer_org) {
  /////////////////////////////////////////
  // Parse header
  var buf8 = new Uint8Array(buffer_org)
  var buffer = buf8.buffer // Make sure we have an ArrayBuffer
  var view = new DataView(buffer)
  if (buffer.byteLength<348) {
    throw new Error("The buffer is not even large enough to contain the minimal header I would expect from a NIfTI file!")
  }

  // First read dim[0], to determine byte order
  var littleEndian = true
  var dim = new Array(8)
  dim[0] = view.getInt16(40, littleEndian)
  if (1>dim[0] || dim[0]>7) {
    littleEndian = !littleEndian
    dim[0] = view.getInt16(40, littleEndian)
  }
  if (1>dim[0] || dim[0]>7) {
    // Even if there were other /byte/ orders, we wouldn't be able to detect them using a short (16 bits, so only two bytes).
    console.warn("dim[0] is out-of-range, we'll simply try continuing to read the file, but this will most likely fail horribly.")
  }

  // Now check header size and magic
  var sizeof_hdr = view.getInt32(0, littleEndian)
  if (sizeof_hdr !== 348 && (1>dim[0] || dim[0]>7)) {
    // Try to recover from weird dim info
    littleEndian = !littleEndian
    dim[0] = view.getInt16(40, littleEndian)
    sizeof_hdr = view.getInt32(0, littleEndian)
    if (sizeof_hdr !== 348) {
      throw new Error("I'm sorry, but I really cannot determine the byte order of the (NIfTI) file at all.")
    }
  } else if (sizeof_hdr < 348) {
    throw new Error("Header of file is smaller than expected, I cannot deal with this.")
  } else if (sizeof_hdr !== 348) {
    console.warn("Size of NIfTI header different from what I expect, but I'll try to do my best anyway (might cause trouble).")
  }
  var magic = String.fromCharCode.apply(null, buf8.subarray(344, 348))
  if (magic !== "ni1\0" && magic !== "n+1\0") {
    throw new Error("Sorry, but this does not appear to be a NIfTI-1 file. Maybe Analyze 7.5 format? or NIfTI-2?")
  }

  // Continue reading actual header fields
  var dim_info = view.getInt8(39)
  dim.length = 1+Math.min(7, dim[0])
  for(var i=1; i<dim.length; i++) {
    dim[i] = view.getInt16(40+2*i, littleEndian)
    if (dim[i]<=0) {
      console.warn("dim[0] was probably wrong or corrupt")
      dim.length = i
    }
  }
  if (dim.length === 1) throw new Error("No valid dimensions!")

  var intent_p1 = view.getFloat32(56, littleEndian)
  var intent_p2 = view.getFloat32(56, littleEndian)
  var intent_p3 = view.getFloat32(56, littleEndian)
  var intent_code = view.getInt16(68, littleEndian)

  var datatype = decodeNIfTIDataType(view.getInt16(70, littleEndian))
  var bitpix = view.getInt16(72, littleEndian)
  var slice_start = view.getInt16(74, littleEndian)

  var pixdim = new Array(dim.length)
  for(var i=0; i<pixdim.length; i++) {
    pixdim[i] = view.getFloat32(76+4*i, littleEndian)
  }

  var vox_offset = view.getFloat32(108, littleEndian)
  var scl_slope = view.getFloat32(112, littleEndian)
  var scl_inter = view.getFloat32(116, littleEndian)
  var slice_end = view.getInt16(120, littleEndian)
  var slice_code = view.getInt8(122)
  var xyzt_units = decodeNIfTIUnits(view.getInt8(123))
  var cal_max = view.getFloat32(124, littleEndian)
  var cal_min = view.getFloat32(128, littleEndian)
  var slice_duration = view.getFloat32(132, littleEndian)
  var toffset = view.getFloat32(136, littleEndian)

  var descrip = String.fromCharCode.apply(null, buf8.subarray(148, 228))
  var aux_file = String.fromCharCode.apply(null, buf8.subarray(228, 252))

  var qform_code = view.getInt16(252, littleEndian)
  var sform_code = view.getInt16(254, littleEndian)

  var quatern_b = view.getFloat32(256, littleEndian)
  var quatern_c = view.getFloat32(260, littleEndian)
  var quatern_d = view.getFloat32(264, littleEndian)
  var qoffset_x = view.getFloat32(268, littleEndian)
  var qoffset_y = view.getFloat32(272, littleEndian)
  var qoffset_z = view.getFloat32(276, littleEndian)

  var srow = new Float32Array(12)
  for(var i=0; i<12; i++) {
    srow[i] = view.getFloat32(280+4*i, littleEndian)
  }

  var intent_name = String.fromCharCode.apply(null, buf8.subarray(328, 344))

  var extension = view.getInt32(348, littleEndian) // Actually a different format, but this suffices for checking === zero
  if (extension !== 0) {
    console.warn("Looks like there are extensions in use in this NIfTI file, which will all be ignored!")
  }

  // Check bitpix

  // "Normalize" datatype (so that rgb/complex become several normal floats rather than compound types, possibly also do something about bits)
  // Note that there is actually both an rgb datatype and an rgb intent... (My guess is that the datatype corresponds to sizes = [3,dim[0],...], while the intent might correspond to sizes = [dim[0],...,dim[5]=3].)

  // Convert to NRRD-compatible structure
  var ret = {}
  ret.dimension = dim[0]
  ret.type = datatype // TODO: Check that we do not feed anything incompatible?
  ret.encoding = 'raw'
  ret.endian = littleEndian ? 'little' : 'big'
  ret.sizes = dim.slice(1) // Note that both NRRD and NIfTI use the convention that the fastest axis comes first!

  if (xyzt_units !== undefined) {
    ret.spaceUnits = xyzt_units
    while(ret.spaceUnits.length < ret.dimension) { // Pad if necessary
      ret.spaceUnits.push("")
    }
    ret.spaceUnits.length = ret.dimension // Shrink if necessary
  }

  if (qform_code === 0) { // "method 1"
    ret.spacings = pixdim.slice(1)
    while(ret.spacings.length < ret.dimension) {
      ret.spacings.push(NaN)
    }
    ret.spaceDimension = Math.min(ret.dimension, 3) // There might be non-3D data sets? (Although the NIfTI format does seem /heavily/ reliant on assuming a 3D space.)
  } else if (qform_code > 0) { // "method 2"
    // TODO: Figure out exactly what to do with the different qform codes.
    ret.space = "right-anterior-superior" // Any method for orientation (except for "method 1") uses this, apparently.
    var qfac = pixdim[0] === 0.0 ? 1 : pixdim[0]
    var a = Math.sqrt(Math.max(0.0,1.0-(quatern_b*quatern_b+quatern_c*quatern_c+quatern_d*quatern_d)))
    var b = quatern_b
    var c = quatern_c
    var d = quatern_d
    ret.spaceDirections = [
      [pixdim[1]*(a*a+b*b-c*c-d*d),pixdim[1]*(2*b*c+2*a*d),pixdim[1]*(2*b*d-2*a*c)],
      [pixdim[2]*(2*b*c-2*a*d),pixdim[2]*(a*a+c*c-b*b-d*d),pixdim[2]*(2*c*d+2*a*b)],
      [qfac*pixdim[3]*(2*b*d+2*a*c),qfac*pixdim[3]*(2*c*d-2*a*b),qfac*pixdim[3]*(a*a+d*d-c*c-b*b)]]
    ret.spaceOrigin = [qoffset_x,qoffset_y,qoffset_z]
  } else {
    console.warn("Invalid qform_code: " + qform_code + ", orientation is probably messed up.")
  }
  // TODO: Here we run into trouble, because in NRRD we cannot expose two DIFFERENT (not complementary, different!) transformations. Even more frustrating is that sform transformations are actually more compatible with NRRD than the qform methods.
  if (sform_code > 0) {
    console.warn("sform transformation are currently ignored.")
  }

  // Read data if it is here
  if (magic === "n+1\0") {
    if (vox_offset<352 || vox_offset>buffer.byteLength) {
      throw new Error("Illegal vox_offset!")
    }
    ret.buffer = buffer.slice(Math.floor(vox_offset))
  }


  // add all header fields to return
  ret.intent_p1 = intent_p1;
  ret.intent_p2 = intent_p2;
  ret.intent_p3 = intent_p3;
  ret.intent_code = intent_code;

  ret.datatype = datatype;
  ret.bitpix = bitpix;
  ret.slice_start = slice_start;

  ret.pixdim = pixdim;

  ret.vox_offset = vox_offset;
  ret.scl_slope = scl_slope;
  ret.scl_inter = scl_inter;
  ret.slice_end = slice_end;
  ret.slice_code = slice_code;
  ret.xyzt_units = xyzt_units;
  ret.cal_max = cal_max;
  ret.cal_min = cal_min;
  ret.slice_duration = slice_duration;
  ret.toffset = toffset;

  ret.descrip = descrip;
  ret.aux_file = aux_file;

  ret.qform_code = qform_code;
  ret.sform_code = sform_code;

  ret.quatern_b = quatern_b;
  ret.quatern_c = quatern_c;
  ret.quatern_d = quatern_d;
  ret.qoffset_x = qoffset_x;
  ret.qoffset_y = qoffset_y;
  ret.qoffset_z = qoffset_z;

  return ret
}

function decodeNIfTIDataType(datatype) {
  switch(datatype) {
  case 1:
    return 'bit'
  case 2:
    return 'uint8'
  case 4:
    return 'int16'
  case 8:
    return 'int32'
  case 16:
    return 'float'
  case 32:
    return 'complex64'
  case 64:
    return 'double'
  case 128:
    return 'rgb24'
  case 256:
    return 'int8'
  case 512:
    return 'uint16'
  case 768:
    return 'uint32'
  case 1024:
    return 'int64'
  case 1280:
    return 'uint64'
  case 1536:
    return 'float128'
  case 1792:
    return 'complex128'
  case 2048:
    return 'complex256'
  case 2304:
    return 'rgba32'
  default:
    console.warn("Unrecognized NIfTI data type: " + datatype)
    return datatype
  }
}

function decodeNIfTIUnits(units) {
  var space, time
  switch(units & 7) {
  case 0:
    space = ""
    break
  case 1:
    space = "m"
    break
  case 2:
    space = "mm"
    break
  case 3:
    space = "um"
    break
  default:
    console.warn("Unrecognized NIfTI unit: " + (units&7))
    space = ""
  }
  switch(units & 56) {
  case 0:
    time = ""
    break
  case 8:
    time = "s"
    break
  case 16:
    time = "ms"
    break
  case 24:
    time = "us"
    break
  case 32:
    time = "Hz"
    break
  case 40:
    time = "ppm"
    break
  case 48:
    time = "rad/s"
    break
  default:
    console.warn("Unrecognized NIfTI unit: " + (units&56))
    time = ""
  }
  return (space === "" && time === "") ? undefined : [space, space, space, time]
}

