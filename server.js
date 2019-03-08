const fs = require('fs');
const fx = require('mkdir-recursive');
const del = require('del');
const restify = require('restify');
const errors = require('restify-errors');
const openpgp = require('openpgp');
const crypto = require('crypto');
const pdftk = require('node-pdftk');
const uniqid = require('uniqid');

// ###

const defaultConf = {
    'port': 8081,
    'host': '0.0.0.0',
    'tmpDir': './tmp/',
    'dataDir': './data/',
    'privateKeyFile' : './keys/private.key',
    'PublicKeyFile' : './keys/public.key',
    'keyPassword' : 'secret',
};

// ###

function main() {
    let server = restify.createServer();

    server.use(restify.plugins.acceptParser(server.acceptable));
    server.use(restify.plugins.queryParser());
    server.use(restify.plugins.bodyParser());

    server.post('/stamp', stamp);
    server.post('/verify', verify);
    server.post('/verify/:CidsStampId', verify);
    server.get('/createKeypair', createKeypair);

    server.pre(restify.pre.userAgentConnection());
    console.log('Listening on port:' + defaultConf.port);

    server.listen(defaultConf.port, defaultConf.host);
}

// ### /createKeypair

function createKeypair(req, res, next) {
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

// ### /stamp

function stamp(req, res, next) {
    console.log(`### stamp uploaded file: ${req.files.upload.name}\n` );
    
    stampUpload(req.files.upload.path, req.files.context.path).then(data => {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(data, 'binary');
    }).catch(error => {
        console.log(error);
        return next(new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message));
    });
}

// ### /verify[/:CidsStampId]

function verify(req, res, next) {
    if (req.files.hasOwnProperty('upload')) {
        console.log(`### verify uploaded file: ${req.files.upload.name}\n` );

        verifyStampOfFile(req.files.upload.path).then(signature => {
            res.writeHead(200, { 'Content-Type': 'plain/text' });
            if (signature.valid) {
                res.end('stamp is valid. signed by keyid ' + signature.keyid.toHex());
            } else {
                res.end('stamp is not valid');
            }
        }).catch(error => {
            return next(error);
        });
    } else if (req.params.hasOwnProperty('md5Sum')) {
        let CidsStampId = req.params.CidsStampId;
        let md5Sum = req.params.md5Sum;
        console.log(`### verify ${CidsStampId} by md5Sum: ${md5Sum}\n`);

        verifyMd5Sum(CidsStampId, md5Sum).then(isMatching => {
            res.writeHead(200, { 'Content-Type': 'plain/text' });
            if (isMatching) {
                res.end('md5Sum is matching');
            } else {
                res.end('md5Sum is not matching');
            }
        }).catch(error => {
            return next(error);
        });
    }
}

// ###

function createUniqTmpDir(prefix) {
    let id = uniqid();

    let uniqTmpDir = defaultConf.tmpDir + prefix + id + '/';
    fx.mkdirSync(uniqTmpDir)

    return uniqTmpDir;
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

function stampUpload(uploadPath, contextPath) {
    return new Promise(async (resolve, reject) => {
        let id = uniqid();
    
        let uniqTmpDir = defaultConf.tmpDir + 'stamp_' + id + '/';
        fx.mkdirSync(uniqTmpDir);
        
        // ok letze go
    
        let uploadFile = uniqTmpDir + 'upload.pdf';
        let signatureFile = uniqTmpDir + 'signature.pgp';
        let stampedFile = uniqTmpDir + 'stamped.pdf';
        let dumpUploadFile = uniqTmpDir + 'upload.dump';
        let dumpNewFile = uniqTmpDir + 'new.dump';
        let hashFile = uniqTmpDir + 'hash.md5';
        let contextFile = uniqTmpDir + 'context.json';
    
        fs.copyFileSync(uploadPath, uploadFile);
        fs.copyFileSync(contextPath, contextFile);

        // extracting dump file from uploaded pdf
        await pdftk.input(uploadFile).dumpData().output(dumpUploadFile);        
    
        // writing new dump file containing stamp id
        let dump = fs.readFileSync(dumpUploadFile);
        let cidsStampDumpInfoPart = 'InfoBegin\nInfoKey: CidsStampId\nInfoValue: ' + id + '\n';
        fs.writeFileSync(dumpNewFile, cidsStampDumpInfoPart + dump);
    
        // writing pdf file with dump containing stamp id
        await pdftk.input(uploadFile).updateInfo(dumpNewFile).output(stampedFile);
    
        // writing hash file for created pdf
        fs.writeFileSync(hashFile, await fileHash(stampedFile));
    
        fs.readFile(defaultConf.privateKeyFile, 'utf8', async (error, privkey) => {
            if (error) {
                console.log(error);
                return next(new errors.NotFoundError("there was something wrong with the request. the error message from the underlying process is: " + error.message));
            } 
    
            // calculating signature for created pdf
            let privKeyObj = (await openpgp.key.readArmored(privkey)).keys[0];
            await privKeyObj.decrypt('secret');
    
            let options = {
                message: openpgp.message.fromBinary(fs.readFileSync(stampedFile)),
                privateKeys: [privKeyObj],
                detached: true,
            };
            
            openpgp.sign(options).then(async data => {
                fs.writeFileSync(signatureFile, data.signature);   

                fx.mkdirSync(defaultConf.dataDir);
                fs.copyFileSync(hashFile, defaultConf.dataDir + id + '.md5');
                fs.copyFileSync(signatureFile, defaultConf.dataDir + id + '.pgp');
                fs.copyFileSync(contextFile, defaultConf.dataDir + id + '.json');
                
                fs.readFile(stampedFile, (error, data) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(data);
                    }

                    // cleanup
                    del(uniqTmpDir);
                });
            });            
        });
    });
}

// ###

function verifyMd5Sum(CidsStampId, md5Sum) {
    return new Promise(async (resolve, reject) => {
        let md5SumDbFile = defaultConf.dataDir + CidsStampId + '.md5';
        if (!fs.existsSync(md5SumDbFile)) {
            console.log('no md5 hash found for this file');
            resolve(false);
        } else {
            let md5SumDb = fs.readFileSync(md5SumDbFile, 'utf8');            
            if (md5SumDb !== md5Sum) {    
                console.log('md5Sums do not equal');            
                console.log('md5Sum DB     : ' + md5SumDb);
                console.log('md5Sum Upload : ' + md5Sum);
                resolve(false);
            } else {
                resolve(true);
            }
        }
    });        
}

// ###

function verifyPgpSignature(CidsStampId, file) {
    return new Promise((resolve, reject) => {
        let signatureDbFile = defaultConf.dataDir + CidsStampId + '.pgp';
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

function verifyStampOfFile(uploadPath) {
    return new Promise(async (resolve, reject) => {
        let uniqTmpDir = createUniqTmpDir('verify_');

        let uploadFile = uniqTmpDir + 'upload.pdf';
    
        fs.copyFileSync(uploadPath, uploadFile);
    
        // ok letze go
    
        let dumpUploadFile = uniqTmpDir + 'upload.dump';
    
        // extracting dump file from uploaded pdf
        await pdftk.input(uploadFile).dumpDataUtf8().output(dumpUploadFile);        
    
        let dumpUpload = fs.readFileSync(dumpUploadFile, 'utf8');
    
        let dumpLines = dumpUpload.split('\n');
    
        let CidsStampId;
        for (let i = 0 ; i < dumpLines.length; i++) {
            let dumpLine = dumpLines[i];
            if ('InfoKey: CidsStampId' === dumpLine) {
                CidsStampId = dumpLines[i+1].replace('InfoValue: ', '');
                break;
            }
        }
    
        if (!CidsStampId) {
            console.log('CidsStampId missing in PDF');
            resolve(false);
        } else {    
            let hashDbFile = defaultConf.dataDir + CidsStampId + '.md5';
        
            if (!fs.existsSync(hashDbFile)) {
                console.log('no md5 hash found for this file');
                resolve(false);
            } else {        
                let md5Sum = await fileHash(uploadFile);
                
                verifyMd5Sum(CidsStampId, md5Sum).then(isMatching => {
                    if (isMatching) {
                        verifyPgpSignature(CidsStampId, uploadFile).then(isMatching => {
                            resolve(isMatching);
                        }).catch(error => {
                            reject(error);
                        });             
                    } else {
                        resolve(false);
                    }
                }).catch(error => {
                    reject(error);
                });
            }
        }
        
        console.log("now cleaning up");
        // cleanup
        del(uniqTmpDir);
    });
}

// ###

main();