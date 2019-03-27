# stamper
document stamping service

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
