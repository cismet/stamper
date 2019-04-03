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

*wor in progress*

---

## starting the service inside a docker container with docker-compose

building the docker image localy (needed only once):
`docker build -t cismet/stamper .`

creating and starting the container using docker-compose:
`docker-compose up -d`

### ...without docker-compose
```shell
docker run -t --rm \
 -p 8082:10010 \
 -v $(pwd)/config/stamper.json:/app/config/stamper.json:ro \
 -v $(pwd)/config/private.key:/app/config/private.key:ro \
 -v $(pwd)/config/public.key:/app/config/public.key:ro \
 -v $(pwd)/data:/app/data \
 cismet/stamper
```

## starting the service without docker
```shell
npm install -g swagger
swagger project start
```
