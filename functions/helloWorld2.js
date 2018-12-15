var commander = require('commander');

module.exports.handler = function(event, context, callback) {   
  callback(null, "helloWorld2");
};
