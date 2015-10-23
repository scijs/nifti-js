"use strict"
var assert = require('assert')

/**
 * nifti
 *
 * Core nifti-js object.
 */
var nifti = {

    /**
     * System Endianness
     *
     * An immediately invoked string set equal
     * to the execution context's endianness.
     * 'big' or 'little'
     */
    systemEndianness: (function() {
        var buf = new ArrayBuffer(4),
        intArr = new Uint32Array(buf),
        byteArr = new Uint8Array(buf);
        intArr[0] = 0x01020304;
        if (byteArr[0]==1 && byteArr[1]==2 && byteArr[2]==3 && byteArr[3]==4) {
            return 'big'
        } else if (byteArr[0]==4 && byteArr[1]==3 && byteArr[2]==2 && byteArr[3]==1) {
            return 'little'
        }
        console.warn("Unrecognized system endianness!")
        return undefined
    })(),

    /**
     * Endianness
     *
     * The endianness of the file currently
     * being parsed. 'big' or 'little'
     */
    endianness: null,

    /**
     * Parse
     *
     * Takes a buffer of a complete NIfTi and
     * parses the header and body data.
     */
    parse: function (niftiBuffer) {
        var header = this.parseHeader(niftiBuffer);
        var parsed  = this.NIfTIToNRRD(header);
        if (header.magic === "n+1\0") {
            var body = this.parseBody(header, niftiBuffer);
            parsed.buffer = body.buffer;
            parsed.data   = body.data;
        }
        return parsed;
    },

    /**
     * Parse Header
     *
     * Takes a buffer of a NIfTI file containing
     * at least the header (first 348 bytes) and
     * returns headers values as JSON.
     */
    parseHeader: function (niftiBuffer) {

        // Check Buffer
        var buf8 = new Uint8Array(niftiBuffer);
        var buffer = buf8.buffer;
        var view = new DataView(buffer);
        if (buffer.byteLength < 348) {
            throw new Error("The buffer is not even large enough to contain the minimal header I would expect from a NIfTI file!");
        }

        // Determine Byte Order
        var littleEndian = true;
        var dim = new Array(8);
        dim[0] = view.getInt16(40, littleEndian);
        if (1 > dim[0] || dim[0] > 7) {
            littleEndian = !littleEndian;
            dim[0] = view.getInt16(40, littleEndian);
        }
        if (1 > dim[0] || dim[0] > 7) {
            // Even if there were other /byte/ orders, we wouldn't be able to detect them using a short (16 bits, so only two bytes).
            console.warn("dim[0] is out-of-range, we'll simply try continuing to read the file, but this will most likely fail horribly.")
        }

        // Check Header Size & Byte Order
        var sizeof_hdr = view.getInt32(0, littleEndian);
        if (sizeof_hdr !== 348 && (1 > dim[0] || dim[0] > 7)) {
            littleEndian = !littleEndian;
            dim[0] = view.getInt16(40, littleEndian);
            sizeof_hdr = view.getInt32(0, littleEndian);
            if (sizeof_hdr !== 348) {
                throw new Error("I'm sorry, but I really cannot determine the byte order of the (NIfTI) file at all.")
            }
        } else if (sizeof_hdr < 348) {
            throw new Error("Header of file is smaller than expected, I cannot deal with this.")
        } else if (sizeof_hdr !== 348) {
            console.warn("Size of NIfTI header different from what I expect, but I'll try to do my best anyway (might cause trouble).")
        }

        // store file endiannesss
        this.endianness = littleEndian ? 'little' : 'big';

        // magic string
        var magic = String.fromCharCode.apply(null, buf8.subarray(344, 348))
        if (magic !== "ni1\0" && magic !== "n+1\0") {
            throw new Error("Sorry, but this does not appear to be a NIfTI-1 file. Maybe Analyze 7.5 format? or NIfTI-2?")
        }

        // dim
        dim.length = 1 + Math.min(7, dim[0]);
        for(var i = 1; i < dim.length; i++) {
            dim[i] = view.getInt16(40 + 2 * i, littleEndian);
            if (dim[i] <= 0) {
                console.warn("dim[0] was probably wrong or corrupt");
                dim.length = i;
            }
        }
        if (dim.length === 1) throw new Error("No valid dimensions!");


        // pixdim
        var pixdim = new Array(dim.length)
        for(var i=0; i<pixdim.length; i++) {
            pixdim[i] = view.getFloat32(76+4*i, littleEndian)
        }

        // srows
        var srow_x = new Array(4),
            srow_y = new Array(4),
            srow_z = new Array(4);
        for (var i = 0; i < 4; i++) {
            srow_x[i] = view.getFloat32(280 + 4 * i, littleEndian);
            srow_y[i] = view.getFloat32(296 + 4 * i, littleEndian);
            srow_z[i] = view.getFloat32(312 + 4 * i, littleEndian);
        }

        // Interpret Header Fields into a JSON object
        var header = {
            sizeof_hdr: view.getInt32(0, littleEndian),
            dim_info: view.getInt8(39),
            dim: dim,
            intent_p1: view.getFloat32(56, littleEndian),
            intent_p2: view.getFloat32(60, littleEndian),
            intent_p3: view.getFloat32(64, littleEndian),
            intent_code: view.getInt16(68, littleEndian),
            datatype: this.decodeNIfTIDataType(view.getInt16(70, littleEndian)),
            bitpix: view.getInt16(72, littleEndian),
            slice_start: view.getInt16(74, littleEndian),
            pixdim: pixdim,
            vox_offset: view.getFloat32(108, littleEndian),
            scl_slope: view.getFloat32(112, littleEndian),
            scl_inter: view.getFloat32(116, littleEndian),
            slice_end: view.getInt16(120, littleEndian),
            slice_code: view.getInt8(122),
            xyzt_units: this.decodeNIfTIUnits(view.getInt8(123)),
            cal_max: view.getFloat32(124, littleEndian),
            cal_min: view.getFloat32(128, littleEndian),
            slice_duration: view.getFloat32(132, littleEndian),
            toffset: view.getFloat32(136, littleEndian),
            glmax: view.getFloat32(140, littleEndian),
            glmin: view.getFloat32(144, littleEndian),
            descrip: String.fromCharCode.apply(null, buf8.subarray(148, 228)),
            aux_file: String.fromCharCode.apply(null, buf8.subarray(228, 252)),
            qform_code: view.getInt16(252, littleEndian),
            sform_code: view.getInt16(254, littleEndian),
            quatern_b: view.getFloat32(256, littleEndian),
            quatern_c: view.getFloat32(260, littleEndian),
            quatern_d: view.getFloat32(264, littleEndian),
            qoffset_x: view.getFloat32(268, littleEndian),
            qoffset_y: view.getFloat32(272, littleEndian),
            qoffset_z: view.getFloat32(276, littleEndian),
            srow_x: srow_x,
            srow_y: srow_y,
            srow_z: srow_z,
            intent_name: String.fromCharCode.apply(null, buf8.subarray(328, 344)),
            magic: magic
        };

        return header;
    },

    /**
     * Parse Body
     */
    parseBody: function (header, niftiBuffer) {
        var buf8 = new Uint8Array(niftiBuffer);
        var buffer = buf8.buffer;
        var body = {};
        if (header.vox_offset < 352 || header.vox_offset > buffer.byteLength) {
            throw new Error("Illegal vox_offset!")
        }
        body.buffer = buffer.slice(Math.floor(header.vox_offset))
        if (header.datatype !== 0) {
            // TODO: It MIGHT make sense to equate DT_UNKNOWN (0) to 'block', with bitpix giving the block size in bits
            body.data = this.parseNIfTIRawData(body.buffer, header.datatype, header.dim, {endianFlag: this.endianness == 'little'});
        }
        return body;
    },

    /**
     * NIfTI to NRRD
     *
     * Takes the parseHeader output and returns it
     * as NRRD format.
     */
     NIfTIToNRRD: function (header) {

        var NRRD = {
            dimension: header.dim[0],
            type:      header.datatype,
            encoding:  'raw',
            endian:    this.endianness,
            sizes:     header.dim.slice(1)
        };

        // Space Units
        if (header.xyzt_units) {
            NRRD.spaceUnits = header.xyzt_units
            // Pad if necessary
            while(NRRD.spaceUnits.length < NRRD.dimension) {
                NRRD.spaceUnits.push("")
            }
            NRRD.spaceUnits.length = NRRD.dimension; // Shrink if necessary
        }

        // Spacings, Space Dimension & Quaterns
        if (header.qform_code === 0) { // "method 1"
            NRRD.spacings = header.pixdim.slice(1)
            while(NRRD.spacings.length < NRRD.dimension) {
                NRRD.spacings.push(NaN)
            }
            NRRD.spaceDimension = Math.min(NRRD.dimension, 3) // There might be non-3D data sets? (Although the NIfTI format does seem /heavily/ reliant on assuming a 3D space.)
        } else if (header.qform_code > 0) { // "method 2"
            // TODO: Figure out exactly what to do with the different qform codes.
            NRRD.space = "right-anterior-superior"; // Any method for orientation (except for "method 1") uses this, apparently.
            var qfac = header.pixdim[0] === 0.0 ? 1 : header.pixdim[0];
            var a = Math.sqrt(Math.max(0.0, 1.0 - (header.quatern_b * header.quatern_b + header.quatern_c * header.quatern_c + header.quatern_d * header.quatern_d)));
            var b = header.quatern_b;
            var c = header.quatern_c;
            var d = header.quatern_d;
            NRRD.spaceDirections = [
                [
                    header.pixdim[1] * (a * a + b * b - c * c - d * d),
                    header.pixdim[1] * (2 * b * c + 2 * a * d),
                    header.pixdim[1] * (2 * b * d - 2 * a * c)
                ],
                [
                    header.pixdim[2] * (2 * b * c - 2 * a * d),
                    header.pixdim[2] * (a * a + c * c - b * b - d * d),
                    header.pixdim[2] * (2 * c * d + 2 * a * b)
                ],
                [
                    qfac * header.pixdim[3] * (2 * b *d + 2 * a * c),
                    qfac * header.pixdim[3] * (2 * c * d - 2 * a * b),
                    qfac * header.pixdim[3] * (a * a + d * d - c * c - b * b)
                ]
            ];
            NRRD.spaceOrigin = [header.qoffset_x, header.qoffset_y, header.qoffset_z];
        } else {
            console.warn("Invalid qform_code: " + header.qform_code + ", orientation is probably messed up.")
        }
        // TODO: Here we run into trouble, because in NRRD we cannot expose two DIFFERENT (not complementary, different!) transformations. Even more frustrating is that sform transformations are actually more compatible with NRRD than the qform methods.
        if (header.sform_code > 0) {
            console.warn("sform transformation are currently ignored.")
        }

        return NRRD;
    },

    /**
     * Parse NIfTI Raw Data
     */
    parseNIfTIRawData: function (buffer, type, dim, options) {
        var i, arr, view, totalLen = 1, endianFlag = options.endianFlag, endianness = endianFlag ? 'little' : 'big';
        for(var i = 1; i < dim.length; i++) {
            totalLen *= dim[i];
        }
        if (type == 'block') {
            // Don't do anything special, just return the slice containing all blocks.
            return buffer.slice(0, totalLen * options.blockSize)
        } else if (type == 'int8' || type == 'uint8' || endianness == this.systemEndianness) {
            switch(type) {
                case "int8":
                    checkSize(1);
                    return new Int8Array(buffer.slice(0, totalLen));
                case "uint8":
                    checkSize(1);
                    return new Uint8Array(buffer.slice(0, totalLen));
                case "int16":
                    checkSize(2);
                    return new Int16Array(buffer.slice(0, totalLen * 2));
                case "uint16":
                    checkSize(2);
                    return new Uint16Array(buffer.slice(0, totalLen * 2));
                case "int32":
                    checkSize(4);
                    return new Int32Array(buffer.slice(0, totalLen * 4));
                case "uint32":
                    checkSize(4);
                    return new Uint32Array(buffer.slice(0, totalLen * 4));
                //case "int64":
                //    checkSize(8);
                //    return new Int64Array(buffer.slice(0, totalLen * 8));
                //case "uint64":
                //    checkSize(8);
                //    return new Uint64Array(buffer.slice(0, totalLen * 8));
                case "float":
                    checkSize(4);
                    return new Float32Array(buffer.slice(0, totalLen * 4));
                case "double":
                    checkSize(8);
                    return new Float64Array(buffer.slice(0, totalLen * 8));
                default:
                    console.warn("Unsupported NIfTI type: " + type);
                    return undefined;
            }
        } else {
            view = new DataView(buffer);
            switch(type) {
                case "int8": // Note that here we do not need to check the size of the buffer, as the DataView.get methods should throw an exception if we read beyond the buffer.
                    arr = new Int8Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getInt8(i);
                    }
                    return arr;
                case "uint8":
                    arr = new Uint8Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getUint8(i);
                    }
                    return arr;
                case "int16":
                    arr = new Int16Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getInt16(i*2);
                    }
                    return arr;
                case "uint16":
                    arr = new Uint16Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getUint16(i*2);
                    }
                    return arr;
                case "int32":
                    arr = new Int32Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getInt32(i*4);
                    }
                    return arr;
                case "uint32":
                    arr = new Uint32Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getUint32(i*4);
                    }
                    return arr;
                //case "int64":
                //    arr = new Int64Array(totalLen);
                //    for(i=0; i<totalLen; i++) {
                //        arr[i] = view.getInt64(i*8);
                //    }
                //    return arr;
                //case "uint64":
                //    arr = new Uint64Array(totalLen);
                //    for(i=0; i<totalLen; i++) {
                //        arr[i] = view.getUint64(i*8);
                //    }
                //    return arr;
                case "float":
                    arr = new Float32Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getFloat32(i*4);
                    }
                    return arr;
                case "double":
                    arr = new Float64Array(totalLen);
                    for(i=0; i<totalLen; i++) {
                        arr[i] = view.getFloat64(i*8);
                    }
                    return arr;
                default:
                    console.warn("Unsupported NRRD type: " + type);
                    return undefined;
            }
        }

        function checkSize(sizeOfType) {
            if (buffer.byteLength<totalLen*sizeOfType) throw new Error("NIfTI file does not contain enough data!")
        }
    },

    /**
     * Decode NIfTI Data Type
     */
    decodeNIfTIDataType: function (datatype) {
        switch(datatype) {
            case 1:
                return 'bit';
            case 2:
                return 'uint8';
            case 4:
                return 'int16';
            case 8:
                return 'int32';
            case 16:
                return 'float';
            case 32:
                return 'complex64';
            case 64:
                return 'double';
            case 128:
                return 'rgb24';
            case 256:
                return 'int8';
            case 512:
                return 'uint16';
            case 768:
                return 'uint32';
            case 1024:
                return 'int64';
            case 1280:
                return 'uint64';
            case 1536:
                return 'float128';
            case 1792:
                return 'complex128';
            case 2048:
                return 'complex256';
            case 2304:
                return 'rgba32';
            default:
                console.warn("Unrecognized NIfTI data type: " + datatype);
                return datatype;
        }
    },

    /**
     * Decode NIfTIUnits
     */
    decodeNIfTIUnits: function (units) {
        var space, time
        switch(units & 7) {
            case 0:
                space = "";
                break;
            case 1:
                space = "m";
                break;
            case 2:
                space = "mm";
                break;
            case 3:
                space = "um";
                break;
            default:
                console.warn("Unrecognized NIfTI unit: " + (units&7));
                space = "";
        }
        switch(units & 56) {
            case 0:
                time = "";
                break;
            case 8:
                time = "s";
                break;
            case 16:
                time = "ms";
                break;
            case 24:
                time = "us";
                break;
            case 32:
                time = "Hz";
                break;
            case 40:
                time = "ppm";
                break;
            case 48:
                time = "rad/s";
                break;
            default:
                console.warn("Unrecognized NIfTI unit: " + (units&56));
                time = "";
        }
        return (space === "" && time === "") ? undefined : [space, space, space, time];
    }

};

module.exports = nifti;