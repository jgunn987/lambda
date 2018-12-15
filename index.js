var config = require('./config.json');
var Promise = require('promise');
var fs = require('fs');
var archiver = require('archiver');
var AWS = require('aws-sdk');
AWS.config.update({ region: config.region });
var lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });
var iam = new AWS.IAM({ apiVersion: '2010-05-08' });

function getOrCreateRole(config) {
  return iam.getRole({ RoleName: config.role.RoleName }).promise()
   .then(function(role) {
     return role.Role; 
   }).catch(function (err) {
     return iam.createRole({
       AssumeRolePolicyDocument: 
         JSON.stringify(config.role.AssumeRolePolicyDocument), 
       RoleName: config.role.RoleName
     }).promise().then(function (r) {
       return r.Role;
     });
   });
}

function getOrCreatePolicy(config) {
  return iam.listPolicies({}).promise().then(function (p) {
    return p.Policies.find(function (policy) {
      return policy.PolicyName === config.policy.PolicyName;
    }); 
  }).then(function (p) {
    if (!p) {
      return iam.createPolicy({
        PolicyDocument: JSON.stringify(config.policy.PolicyDocument), 
        PolicyName: config.policy.PolicyName
      }).promise().then(function (p) {
        return p.Policy;
      });
    }
    return p;
  });
}

function setupRoleAndPolicy(config) {
  return Promise.all([
    getOrCreateRole(config),
    getOrCreatePolicy(config)
  ]).then(function (r) {
    return iam.attachRolePolicy({
      PolicyArn: r[1].Arn,
      RoleName: r[0].RoleName
    }).promise().then(Boolean);
  });
}

function createZip(name) {
  return new Promise(function (resolve, reject) {
    var zipfile = '/tmp/functions.' + name + '.js.zip';
    var output = fs.createWriteStream(zipfile);
    var archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function () {
      resolve(fs.readFileSync(zipfile));    
    });
    
    archive.pipe(output);

    archive.append(fs.createReadStream(
      __dirname + '/functions/' + name + '.js'
    ), { name: name + '.js' });
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.finalize();
  });
}

function createLayerZip(name, directories) {
  return new Promise(function (resolve, reject) {
    var zipfile = '/tmp/layer.' + name + '.zip';
    var output = fs.createWriteStream(zipfile);
    var archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', function () {
      resolve(fs.readFileSync(zipfile));    
    });
    
    archive.pipe(output);

    directories.forEach(function (d) {
      archive.directory('./' + d, d);  
    });
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.finalize();
  });
}

function publishLayers(config) {
  return Promise.all(Object.keys(config.layers).map(function (name) {
    return publishLayer(config, name, config.layers[name]);
  }));
}

function publishLayer(config, name, info) {
  return createLayerZip(name, info.includes).then(function(buffer) {
      console.log('publishing layer');
    return lambda.publishLayerVersion({
      Content: { ZipFile: buffer },
      LayerName: name,
    }).promise();
  });
}

function createFunction(config, name, arn, info) {
  return createZip(name).then(function (buffer) {
    return lambda.createFunction(Object.assign({}, info, {
      Code: { ZipFile: buffer }, 
      FunctionName: name,
      Handler: name + '.handler',
      Role: arn
    })).promise();
  });
}

function updateFunction(config, name, arn, info) {
  //return updateFunctionConfiguration(Object.assign({
  //  FunctionName: name
 // }, info)).promise().then(function () {
    return createZip(name).then(function (buffer) {
      return lambda.updateFunctionCode({
        FunctionName: name,
        Publish: true,
        ZipFile: buffer
      }).promise();
    });
 // });
}

function deployFunctions(config, roleArn) {
  return Promise.all(Object.keys(config.functions).map(function (k) {
    return lambda.getFunction({ FunctionName: k }).promise()
      .then(function (fn) {
        return updateFunction(config, k, roleArn, config.functions[k]);
      }).catch(function (err) {
        return createFunction(config, k, roleArn, config.functions[k]);
      });
  }));
}


publishLayers(config).then(console.log)
  .catch(console.log);
/*
setupRoleAndPolicy(config).then(function() {
  return getOrCreateRole(config).then(function (role) {
    return deployFunctions(config, role.Arn);
  });
}).then(console.log)
  .catch(console.log);
*/

//setupRoleAndPolicy(config)
//.then(console.log)
//.catch(console.log);

