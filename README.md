# Stamper

A stamping service for documents, that allows you to verify if a document has been stamped and not modified since.

## What it is not

* Not a signature service. The document will contain **no** signature, and the validity of the document can't be verified without the service.

## What it is

* A stamping service that adds a stamp to the metadata of a given document, with which the validity of the document can later on be confirmed.

## What can i do with it

* Upload a document which will be provided with a stamp and returned as a download.
* Upload a JSON object containing the information for a request. The request will be executed and the result will be stamped and returned as a download.
* Upload a document for stamp verification. A JSON object will be returned which contains the in formation if the stamp was valid and the document hasn't been modified since it was stamped.
* Request the PGP signature of a document for a given stamp-id. This allows you to verify the validity of the stamp yourself even without having access to the service.

---

## How it works

* stamp a document via upload:

![stampUpload](https://user-images.githubusercontent.com/1787908/55465707-fced2e80-55fd-11e9-86e2-26303ce45669.png)

* stamp a document via request:

![stampRequest](https://user-images.githubusercontent.com/1787908/55465704-fced2e80-55fd-11e9-8e4c-3cd585d2e695.png)

* verify a stamped document:

![stampVerification](https://user-images.githubusercontent.com/1787908/55465705-fced2e80-55fd-11e9-85fe-994f3124d8eb.png)

---

## How to start the service

### starting the service inside a docker container with docker-compose

building the docker image localy (needed only once):
`docker build -t cismet/stamper .`

creating and starting the container using docker-compose:
`docker-compose up -d`

#### ...without docker-compose
```shell
docker run -t --rm \
 -p 8082:10010 \
 -v $(pwd)/config/stamper.json:/app/config/stamper.json:ro \
 -v $(pwd)/config/private.key:/app/config/private.key:ro \
 -v $(pwd)/config/public.key:/app/config/public.key:ro \
 -v $(pwd)/data:/app/data \
 cismet/stamper
```

### starting the service without docker
```shell
npm install -g swagger
swagger project start
```

---

## How to use the service

### swagger API documentation

To get the swagger API documentation you can start the project with:
```shell
swagger project edit
```

The documentation looks like this:
![api](https://user-images.githubusercontent.com/1787908/55465723-05de0000-55fe-11e9-948a-146e0205abf8.png)

### sending requests to the api with curl

* upload a document to get it back stamped:
```shell
SERVICE=http://localhost:10010
INPUT_FILE=<your_file_here>
OUTPUT_FILE=stamped_$INPUT_FILE

curl -s -X POST -H "Content-Type: multipart/form-data" -F "document=@$INPUT_FILE" -F "password=secret" $SERVICE/stampDocument -o "$OUTPUT_FILE"
```

* upload a request definition to get a stamped document from another service:
  
```json
// request.json
{
  "url" : "<your request url here>",
  "options" : "<your fetch options here (optional)>"
}
```
```shell
SERVICE=http://localhost:10010
OUTPUT_FILE=stamped_$INPUT_FILE

curl -s -X POST -H "Content-Type: multipart/form-data" -F "requestJson=@request.json" -F "password=secret" $SERVICE/stampRequest -o "$OUTPUT_FILE"
```

* upload a stamped document for verification:
```shell
SERVICE=http://localhost:10010
INPUT_FILE=<your_file_here>

curl -s -X POST -H "Content-Type: multipart/form-data" -F "document=@$INPUT_FILE" $SERVICE/verifyDocumentStamp
```
