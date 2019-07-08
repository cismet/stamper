FROM node:carbon-alpine

ENV TZ Europe/Berlin

WORKDIR /app

COPY ./api ./api
COPY ./config/default.yaml ./config/default.yaml 
COPY ./package.json ./app.js ./

RUN apk --no-cache add git pdftk && npm install -g swagger && npm install

VOLUME ./data

EXPOSE 10010

CMD ["swagger", "project", "start"]
