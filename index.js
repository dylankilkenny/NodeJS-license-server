const express = require('express');
const app = express();
const fs = require('fs')
const btoa = require('btoa')
const fetch = require("node-fetch")
const cors = require('cors')
const bodyParser = require('body-parser');
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({extended: true})); // for parsing application/x-www-form-urlencoded
app.use(cors())
const acc = ""; //Keygen.sh account ID
const policy = ""; //Keygen.sh Policy ID
const bearer = "" //Keygen.sh Account Slug

// Use this cors config for production, allowing authorized origins to connect

// app.use(function (req, res, next) {
//     // Website you wish to allow to connect
//     var allowedOrigins = ['http://localhost:5000/signup'];
//     var origin = req.headers.origin;
//     if (allowedOrigins.indexOf(origin) > -1) {
//         res.setHeader('Access-Control-Allow-Origin', origin);
//     }
//     // Request methods you wish to allow
//     res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
//     // Request headers you wish to allow
//     res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
//     // Set to true if you need the website to include cookies in the requests sent
//     // to the API (e.g. in case you use sessions)
//     res.setHeader('Access-Control-Allow-Credentials', true);
//     // Pass to next layer of middleware
//     next();
// });

app.get('/', function (req, res) {
    res.send('Hello Dev!');
});

//Sign up
app.post('/signup', function (req, res) {

    var firstname = req.body.firstname,
        lastname = req.body.lastname,
        email = req.body.email,
        password = req.body.password;

    register(firstname, lastname, email, password, function(user){
        createLicense(user, function(license){
            //return license key
            res.send(license)
        })
    });

});

app.post('/validateLicense', function (req, res) {
    var machine = {}
    machine.fingerprint = req.body.fingerprint;
    machine.platform = req.body.fingerprint;
    validateLicense(req.body.key, machine, res);
});

// app.get('/passwordcheck', function (req, res) {
//     fs.readFile('pwds.json', 'utf8', function readFileCallback(err, data) {
//         if (err) {
//             console.log(err);
//         } else {
//             console.log("in")
//             obj = JSON.parse(data); //now it an object

//             var pwd = [];
//             for (var i in obj.pwds) {
//                 pwd.push(obj.pwds[i]);
//             }
//             if (pwd.indexOf(req.query.pass) > -1) {
//                 var ind = pwd.indexOf(req.query.pass)
//                 pwd.splice(ind, 1);
//                 obj.pwds = pwd 
//                 json = JSON.stringify(obj); //convert it back to json
//                 fs.writeFile('pwds.json', json, 'utf8'); // write it back 
//                 res.sendFile(__dirname + '/signup.html');
//             } else {
//                 res.json({
//                     "error": "Incorrect Password!"
//                 });
//             }
//         }
//     });
// })

async function register(firstname, lastname, email, password, callback) {

    // Create the user

    const response = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/users`, {
        method: "POST",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json"
        },
        body: JSON.stringify({
            "data": {
                "type": "users",
                "attributes": {
                    "firstName": firstname,
                    "lastName": lastname,
                    "email": email,
                    "password": password

                }
            }
        })
    })

    const {
        data: user,
        errors
    } = await response.json()
    if (errors) {
        console.log(errors)
    }

    console.log(`Our user's name is: ${user.attributes.fullName}`)

    callback(user.id);
    // auth(email, password);
}

async function auth(email, password) {

    // Base64 encode the email/password for Authorization header
    const credentials = Buffer.from(`${email}:${password}`).toString('base64');

    // Create the token
    const response = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/users`, {
        method: "POST",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json",
            "Authorization": `Basic ${credentials}`
        }
    })

    var token = await response.json()
    // console.log(JSON.stringify(token))
    // const {
    //     data: token,
    //     errors
    // } = await response.json()
    // if (errors) {
    //     console.log(errors)
    // }

    console.log(`Our user's new token is: ${token.attributes.token}`)

    createLicense(token.data.relationships.bearer.data.id)
}

async function createLicense(user, callback) {
    var key = await generateProductKey();

    const response = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/licenses`, {
        method: "POST",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json",
            "Authorization": bearer
        },
        body: JSON.stringify({
            "data": {
                "type": "licenses",
                "attributes": {
                    "key": key
                },
                "relationships": {
                    "policy": {
                        "data": {
                            "type": "policies",
                            "id": policy
                        }
                    },
                    "user": {
                        "data": {
                            "type": "users",
                            "id": user
                        }
                    }
                }
            }
        })
    })

    const {
        data: license,
        errors
    } = await response.json()
    if (errors) {
        console.log(errors)
    }
    
    console.log(`Our Users license key is: ${license.attributes.key}`)
    callback(license.attributes.key);
}

async function validateLicense(key, machine, res) {

    var license = await retrieveLicense(key);
    var machines = await getMachine(license.relationships.machines.links.related)
    if(machines.length == 0){
        await addMachine(machine, license.id)
        machines = await getMachine(license.relationships.machines.links.related)
    }

    const validation = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/licenses/actions/validate-key`, {
        method: "POST",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json"
        },
        body: JSON.stringify({
            "meta": {
                "key": key,
                "scope":{
                    "machine": machines[0].id,
                    "fingerprint": machine.fingerprint
                }
            }
        })
    })


    const {
        meta
    } = await validation.json()

    if (meta.valid) {
        res.json({
            success: meta
        });
    } else if (meta.detail == "machine scope is required") {//Allow only 1 machine per license
        var licenseID = await retrieveLicense(key);
        addMachine(machine,licenseID);
    } else {
        res.json({
            errors: meta
        });
    }
}

async function retrieveLicense(key) {
    const response = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/licenses/${key}`, {
        method: "GET",
        headers: {
            "Accept": "application/vnd.api+json",
            "Authorization": bearer
        }
    })

    const {
        data,
        errors
    } = await response.json()

    if(errors){
        console.log(errors)
    }

    
    return data;
}

async function getMachine(link) {

    const response = await fetch("https://api.keygen.sh"+link, {
        method: "GET",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json",
            "Authorization": bearer
        }
    })

    const {
        data,
        errors
    } = await response.json()
    
    return data;
}

async function addMachine(machine, id) {

    const response = await fetch(`https://api.keygen.sh/v1/accounts/${acc}/machines`, {
        method: "POST",
        headers: {
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json",
            "Authorization": bearer
        },
        body: JSON.stringify({
            "data": {
                "type": "machines",
                "attributes": {
                    "fingerprint": machine.fingerprint,
                    "platform": machine.platform,
                    "name": "Generic"
                },
                "relationships": {
                    "license": {
                        "data": {
                            "type": "licenses",
                            "id": id
                        }
                    }
                }
            }
        })
    })

    const {
        data,
        errors
    } = await response.json()
    
}



function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateProductKey() {
    var tokens = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        chars = 5,
        segments = 4,
        keyString = "";

    for (var i = 0; i < segments; i++) {
        var segment = "";

        for (var j = 0; j < chars; j++) {
            var k = getRandomInt(0, 35);
            segment += tokens[k];
        }

        keyString += segment;

        if (i < (segments - 1)) {
            keyString += "-";
        }
    }

    return keyString;

}
generateProductKey()


process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    // application specific logging, throwing an error, or other logic here
});

app.listen(5000, function () {
    console.log('Dev app listening on port 5000!');
});