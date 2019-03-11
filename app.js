'use strict';

var SwaggerRestify = require('swagger-restify-mw');
var restify = require('restify');
var server = restify.createServer();

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
