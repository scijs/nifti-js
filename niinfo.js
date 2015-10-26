var nifti = require('./nifti.js')
var fs = require('fs')
var opts = require('yargs').usage("Usage: node niinfo NII_FILE").demand(1).argv

var file = nifti.parseHeader(fs.readFileSync(opts._[0]))
console.log(file)
