'use strict';

const SwaggerRestify = require('swagger-restify-mw');
const restify = require('restify');
const server = restify.createServer();

module.exports = server; // for testing

var config = {
  appRoot: __dirname // required config
};

SwaggerRestify.create(config, function(err, swaggerRestify) {
  if (err) { throw err; }

  swaggerRestify.register(server);

  var port = process.env.PORT || 10010;
  server.listen(port);
});
