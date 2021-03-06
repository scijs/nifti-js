NIfTI support for Javascript
===========================

This can parse files in the [Neuroimaging Informatics Technology Initiative format](http://nifti.nimh.nih.gov/) (version 1). Currently, data (as opposed to the header) can only be read from ".nii" files (files that include both the header and the data in one file), you can still read the header from a header-only file though.

[![build status](https://secure.travis-ci.org/scijs/nifti-js.png)](http://travis-ci.org/scijs/nifti-js)

Note that the output is compatible with what is output by [nrrd-js](https://github.com/jaspervdg/nrrd-js). The main area where this breaks down (so far) is encoding orientation information. The NIfTI file format allows for two different transformations in one file (with various options for specifying the transformations). In contrast, the NRRD format only supports a very simple scheme whereby the "data axes" can be mapped to basis vectors in the physical space (in addition to another scheme more or less corresponding to "method 1" in the NIfTI format). Currently, nifti-js simply discards one type of transformation (the sform transformation).

Also note that for now quite a lot of what is read from the NIfTI file is discarded. The idea is that eventually most of what is now discarded should be mapped to NRRD attributes as much as possible, with the rest mapping to key/value pairs (for example).

## Example
To use with [ndarray](https://github.com/mikolalysenko/ndarray), proceed as follows:

```javascript
var file = nifti.parse(...);
var array = ndarray(file.data, file.sizes.slice().reverse());
```

## Install
Install using [npm](https://www.npmjs.com/):

    npm install nifti-js

## API

#### `require("nifti-js").parse(buffer)`
Parses header and data from `buffer`, returning an object with NRRD-compatible properties. Expects an `ArrayBuffer` or `Buffer` object.

#### `require("nifti-js").parseHeader(buffer)`
Parses just the header from `buffer`, returning an object with NRRD-compatible properties. Expects an `ArrayBuffer` or `Buffer` object.

#### `require("nifti-js").parseNIfTIHeader(buffer)`
Parses just the header from `buffer`, returning an object with the raw NIfTI information. Expects an `ArrayBuffer` or `Buffer` object.

## License
(c) 2015 Jasper van de Gronde. MIT License
