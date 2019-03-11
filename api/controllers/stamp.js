'use strict';

const fs = require('fs');
const errors = require('restify-errors');
const fx = require('mkdir-recursive');
const del = require('del');
const openpgp = require('openpgp');
const crypto = require('crypto');
const pdftk = require('node-pdftk');
const uniqid = require('uniqid');
const path = require('path');
const request = require('request');

module.exports = {
  createKeypair: apiCreateKeypair,
  stampDocument: apiStampDocument,
  stampRequest: apiStampRequest,
  verifyDocumentStamp: apiVerifyDocumentStamp,
  verifyMd5sum: apiVerifyMd5sum,
  verifyPgpSignature: apiVerifyPgpSignature,
};

// ###

const defaultConf = {
  'tmpDir': './tmp/',
  'dataDir': './data/',
  'privateKeyFile' : './keys/private.key',
  'PublicKeyFile' : './keys/public.key',
  'keyPassword' : 'secret',
};

// ###

function apiCreateKeypair(req, res) {
  let options = {
      userIds: [{ name: 'cismet', email: 'mail@cismet.de' }],
      numBits: 2048,
      passphrase: defaultConf.keyPassword,
  };

  openpgp.generateKey(options).then(key => {
      let privKey = key.privateKeyArmored;
      let publKey = key.publicKeyArmored;
      console.log(privKey)
      console.log(publKey)
      res.writeHead(200, { 'Content-Type': 'plain/text' });
      res.end('keypair generated and printed out in console');        
  });          
}

// ### 

function apiStampDocument(req, res) {
  let documentBuffer = req.files.document[0].buffer;
  let contextBuffer = Object.prototype.hasOwnProperty.call(req.files, 'context') ? req.files.context[0].buffer : null;
  
  new Promise(async (resolve, reject) => {
    let uniqTmpDir = createUniqTmpDir('stamp_');
    let documentFile = uniqTmpDir + 'upload.pdf';
    let contextFile = uniqTmpDir + 'context.json';

    fs.writeFileSync(documentFile, documentBuffer);
    if (contextBuffer) {
      fs.writeFileSync(contextFile, contextBuffer);
    }

    stampFile(documentFile).then(stampData => {
        let stampId = stampData.stampId;

        fx.mkdirSync(defaultConf.dataDir);

        fs.copyFileSync(stampData.hashFile, defaultConf.dataDir + stampId + '.md5');
        fs.copyFileSync(stampData.signatureFile, defaultConf.dataDir + stampId + '.pgp');
        if (contextBuffer) {
          fs.copyFileSync(contextFile, defaultConf.dataDir + stampId + '.json');
        }

        fs.readFile(stampData.stampedFile, (error, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
            try { // cleanup              
              del(uniqTmpDir);
            } catch(error) {
              console.log(error);
            }
        });
    }).catch(error => {
      console.log(error);
        reject(error);
    });      
  }).then(data => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(data, 'binary');
  }).catch(error => {
      console.log(error);
      return next(new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message));
  });
}

// ### 

function apiStampRequest(req, res) {
  let requestJsonBuffer = req.files.requestJson[0].buffer;
  let contextBuffer = Object.prototype.hasOwnProperty.call(req.files, 'context') ? req.files.context[0].buffer : null;

  new Promise(async (resolve, reject) => {
    let uniqTmpDir = createUniqTmpDir('stamp_');
    let requestFile = uniqTmpDir + 'request.json';
    let contextFile = uniqTmpDir + 'context.json';
    
    fs.writeFileSync(requestFile, requestJsonBuffer);
    if (contextBuffer) {
      fs.writeFileSync(contextFile, contextBuffer);
    }

    let requestData = JSON.parse(requestJsonBuffer);
    let requestUrl = requestData.url;

    let file = uniqTmpDir + 'file.pdf';
    request({ 'url' : requestUrl, 'encoding': null }, (error, response, body) => {
        if (error) {
            return reject(error);
        }

        fs.writeFileSync(file, body);
        stampFile(file).then(stampData => {
            let stampId = stampData.stampId;

            fx.mkdirSync(defaultConf.dataDir);

            fs.copyFileSync(stampData.hashFile, defaultConf.dataDir + stampId + '.md5');
            fs.copyFileSync(stampData.signatureFile, defaultConf.dataDir + stampId + '.pgp');
            if (contextBuffer) {
              fs.copyFileSync(contextFile, defaultConf.dataDir + stampId + '.json');
            }

            fs.readFile(stampData.stampedFile, (error, data) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(data);
                }
                try { // cleanup              
                  del(uniqTmpDir);
                } catch(error) {
                  console.log(error);
                }    
            });

        }).catch(error => {
            reject(error);
        });    
    });
  }).then(data => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(data, 'binary');
  }).catch(error => {
      console.log(error);
      throw new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message);
  });
}

// ###

function apiVerifyDocumentStamp(req, res) {
  let documentBuffer = req.files.document[0].buffer;

  return new Promise(async (resolve, reject) => {
    let uniqTmpDir = createUniqTmpDir('verify_');

    let uploadFile = uniqTmpDir + 'upload.pdf';

    fs.writeFileSync(uploadFile, documentBuffer);

    // ok letze go

    let dumpUploadFile = uniqTmpDir + 'upload.dump';

    // extracting dump file from uploaded pdf
    await pdftk.input(uploadFile).dumpDataUtf8().output(dumpUploadFile);        

    let dumpUpload = fs.readFileSync(dumpUploadFile, 'utf8');

    let dumpLines = dumpUpload.split('\n');

    let cidsStampId = '';
    for (let i = 0 ; i < dumpLines.length; i++) {
        let dumpLine = dumpLines[i];
        if ('InfoKey: cidsStampId' === dumpLine) {
            cidsStampId = dumpLines[i+1].replace('InfoValue: ', '');
            break;
        }
    }

    console.log('cidsStampId:', cidsStampId);
    if (cidsStampId) {
        let md5Sum = await fileHash(uploadFile);            
        verifyMd5Sum(cidsStampId, md5Sum).then(isMd5sumMatching => {
          if (isMd5sumMatching) {
              verifyPgpSignature(cidsStampId, uploadFile).then(pgpSignature => {
                let isStampValid = pgpSignature.valid;
                let stampVerificationJson = { 'stampIsValid': isStampValid, 'stampId' : cidsStampId };
                console.log('verifyDocumentStamp.resolve:', stampVerificationJson);  
                resolve(stampVerificationJson);
              }).catch(error => {
                  return reject(error);
              });             
          } else {
            let stampVerificationJson = { 'stampIsValid': false, 'stampId' : cidsStampId };
            console.log('verifyDocumentStamp.resolve:', stampVerificationJson);  
            resolve(stampVerificationJson);
          }
          try { // cleanup              
            del(uniqTmpDir);
          } catch(error) {
            console.log(error);
          }
        }).catch(error => {
            reject(error);
        });
    } else {
      let stampVerificationJson = { 'stampIsValid': false, 'stampId' : cidsStampId };
      console.log('verifyDocumentStamp.resolve:', stampVerificationJson);  
      resolve(stampVerificationJson);      
    }
  }).then(stampVerificationJson => {
      res.json(stampVerificationJson);    
  }).catch(error => {
      throw error;
  });
}

// ###

function apiVerifyMd5sum(req, res) {
  let cidsStampId = req.swagger.params.stampId.value;
  let md5Sum = req.swagger.params.md5sum.value;

  verifyMd5Sum(cidsStampId, md5Sum).then(isMatching => {
    let md5sumVerificationJson = { 'md5sumIsMatching': isMatching, 'stampId' : cidsStampId };
    console.log('apiVerifyMd5sum.resolve:', md5sumVerificationJson);
    res.json(md5sumVerificationJson);
  }).catch(error => {
      return next(error);
  });
}

// ###

function apiVerifyPgpSignature(req, res) {
  let pgpSignatureVerificationJson = { 'pgpSignatureIsMatching': false, 'stampId' : null };
  res.json(pgpSignatureVerificationJson);    
}

// ###

function createUniqTmpDir(prefix) {
  let id = uniqid();

  let uniqTmpDir = defaultConf.tmpDir + prefix + id + '/';
  fx.mkdirSync(uniqTmpDir)

  return uniqTmpDir;
}

// ###

async function stampFile(file) {

  let fileDir = path.dirname(file) + '/';
  let signatureFile = fileDir + 'signature.pgp';
  let dumpUploadFile = fileDir + 'orig.dump';
  let dumpNewFile = fileDir + 'new.dump';
  let stampedFile = fileDir + 'stamped.pdf';
  let hashFile = fileDir + 'hash.md5';

  return new Promise(async (resolve, reject) => {
      let stampId = uniqid();

      try {
        // extracting dump file from uploaded pdf
        await pdftk.input(file).dumpData().output(dumpUploadFile);        
      } catch (error) {
        return reject(new errors.InternalError('could not extract dump'));
      }
  
      // writing new dump file containing stamp id
      let dump = fs.readFileSync(dumpUploadFile);
      let cidsStampDumpInfoPart = 'InfoBegin\nInfoKey: cidsStampId\nInfoValue: ' + stampId + '\n';
      fs.writeFileSync(dumpNewFile, cidsStampDumpInfoPart + dump);
  
      try {
        // writing pdf file with dump containing stamp id
        await pdftk.input(file).updateInfo(dumpNewFile).output(stampedFile);
      } catch (error) {
        return reject(newerrors.InternalError('could not overwrite dump'));
      }

      try {
        // writing hash file for created pdf
        fs.writeFileSync(hashFile, await fileHash(stampedFile));
      } catch (error) {
        return reject(new errors.InternalError('could not write filehash'));
      }

      fs.readFile(defaultConf.privateKeyFile, 'utf8', async (error, privkey) => {
          if (error) {
              console.log(error);
              reject(new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message));
          } 
  
          // calculating signature for created pdf
          let privKeyObj = (await openpgp.key.readArmored(privkey)).keys[0];
          await privKeyObj.decrypt('secret');
  
          let options = {
              message: openpgp.message.fromBinary(fs.readFileSync(stampedFile)),
              privateKeys: [privKeyObj],
              detached: true,
          };
          
          openpgp.sign(options).then(data => {
              fs.writeFileSync(signatureFile, data.signature);   
              resolve({
                  'stampId': stampId,
                  'hashFile': hashFile,                    
                  'signatureFile': signatureFile,                    
                  'stampedFile': stampedFile,                    
              });                
          });
      });        
  });
}

// ###

function fileHash(filename, algorithm = 'md5') {
  return new Promise((resolve, reject) => {
      let hash = crypto.createHash(algorithm);
      let stream = fs.ReadStream(filename)
      stream.on('data', (data) => {
          hash.update(data)
      })
      stream.on('end', () => {            
          resolve(hash.digest('hex'));
      })
  });
}

// ###

function verifyPgpSignature(cidsStampId, file) {
  return new Promise((resolve, reject) => {
      let signatureDbFile = defaultConf.dataDir + cidsStampId + '.pgp';
      if (!fs.existsSync(signatureDbFile)) {
          return reject(new errors.NotFoundError('no signature found for this file'));
      }

      fs.readFile(defaultConf.privateKeyFile, 'utf8', async (error, pubkey) => {
          if (error) {
              console.log(error);
              return reject(new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message));
          } 

          let stream = fs.readFileSync(file)
          let pgpSignature = fs.readFileSync(signatureDbFile);

          let options = {
              message: openpgp.message.fromBinary(stream),
              signature: await openpgp.signature.readArmored(pgpSignature),
              publicKeys: (await openpgp.key.readArmored(pubkey)).keys
          };
          
          openpgp.verify(options).then(verified => {
              resolve(verified.signatures[0]);
          });
      });        
  });        
}

// ###

function verifyMd5Sum(cidsStampId, md5Sum) {
  return new Promise(async (resolve, reject) => {
      let md5SumDbFile = defaultConf.dataDir + cidsStampId + '.md5';
      console.log(md5SumDbFile);
      if (!fs.existsSync(md5SumDbFile)) {
          console.log('no md5 hash found for this file');
          resolve(false);
      } else {
          let md5SumDb = fs.readFileSync(md5SumDbFile, 'utf8');            
          if (md5SumDb !== md5Sum) {    
              console.log('md5Sum stored    : ' + md5SumDb);
              console.log('md5Sum requested : ' + md5Sum);
              resolve(false);
          } else {
              resolve(true);
          }
      }
  });        
}
