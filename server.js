var PORT = 8080; //Set port for the app
var accessToken = ""; //Can be set here or as start parameter (node server.js --accesstoken=MYTOKEN)
var disableSmallestScreen = false; //Can be set to true if you dont want to show (node server.js --disablesmallestscreen=true)
var webdav = false; //Can be set to true if you want to allow webdav save (node server.js --webdav=true)

var fs = require("fs-extra");
var fsp = require("fs-extra-promise");
var express = require('express');
var bodyParser = require('body-parser');
var formidable = require('formidable'); //form upload processing
var xss = require("xss");
var ImageKit = require("imagekit");
var request = require('request');

const createDOMPurify = require('dompurify'); //Prevent xss
const { JSDOM } = require('jsdom');
const window = (new JSDOM('')).window;
const DOMPurify = createDOMPurify(window);

const { createClient } = require("webdav");

var app = express();
app.use(express.static(__dirname + '/public'));

// accept large bodies
// app.use(bodyParser.json({ parameterLimit: 5000000, limit: '5000kb' }));
// app.use(bodyParser.urlencoded({ parameterLimit: 500000000, limit: '500000kb', extended: false }));

var imagekit = new ImageKit({
  publicKey:   "public_SFl3jDcVhbQORQSOwx8dHFFJsTU=",
  privateKey:  "private_vwkG8Nbvaj4FyQaxH6RwUEdFtjw=",
  urlEndpoint: "https://ik.imagekit.io/ruptive"
});

var webdavaccess = {
  webdavserver: 'https://cloud.ruptive.cx/remote.php/dav/files/whiteboard/',
  webdavpath: '/whiteboards/',
  webdavusername: 'whiteboard',
  webdavpassword: 'whiteboard'
}

if (process.env.accesstoken) {
    accessToken = process.env.accesstoken;
}
if (process.env.disablesmallestscreen) {
    disablesmallestscreen = true;
}

var startArgs = getArgs();
if (startArgs["accesstoken"]) {
    accessToken = startArgs["accesstoken"];
}
if (startArgs["disablesmallestscreen"]) {
    disableSmallestScreen = true;
}

if (accessToken !== "") {
    // console.log("AccessToken set to: " + accessToken);
}
if (disableSmallestScreen) {
    console.log("Disabled showing smallest screen resolution!");
}
if (webdav) {
    // console.log("Webdav save is enabled!");
}

// app.get('/versions', function(req, res) {
//   var whiteboardId = req["query"]["wid"];
//
//   imagekit.listFiles({
//     path : "products"
//   },
//   (error, result) => {
//     if(error) console.log(error);
//     else console.log(result);
//   });
// })

app.get('/loadwhiteboard', function (req, res) {
  var remotePath = `${webdavaccess.webdavpath}${whiteboardId}`;
  var master = req["query"]["master"];
  var whiteboardId = req["query"]["wid"];
  var whiteboardName = req["query"]["name"];
  var at = req["query"]["at"]

  const getImageData = (url) => {
    request(url, (error, response, body) => {
      if(body && body !== 'Not Found') {

        res.status(200).send(JSON.parse(body))
      }
      else {
        console.log(error)

        res.status(200).send('no file')
      }
    });
  }

  if(accessToken === "" || accessToken == at) {
    if(whiteboardName) {
      getImageData(`https://ik.imagekit.io/ruptive/whiteboards/${whiteboardId}/${whiteboardName}`)
    }
    else {
      imagekit.listFiles({
        path: `whiteboards/${whiteboardId}`
      },
      (error, result) => {
        if(error) console.log(error);

        else {
          let latest = result
          .filter(r => r.name.includes('.txt'))
          .sort((a, b) => (a.name < b.name) ? 1 : -1)

          if(latest[0] && latest[0].url) {
            getImageData(latest[0].url)
          }
          else {
            res.status(200).send('no file')
          }
        }
      });
    }
  }
  else {
    res.sendStatus(500)
  }
})

app.post('/save', function (req, res) {
  return processFormData(req, res)
});

app.post('/upload', function (req, res) {
  return processFormData(req, res)
});

const progressUploadFormData = (formData) => {
  return new Promise((resolve, reject) => {
    var whiteboardId = formData.fields["whiteboardId"];
    // var fields = formData.fields;
    var fields = escapeAllContentStrings(formData.fields);
    var files = formData.files;

    var date = fields["date"] || (+new Date());

    var imagefile = `${fields["name"] || whiteboardId}_${date}.png`;
    var textfile  = `${whiteboardId}_${date}.txt`;

    var imagedata  = fields["imagedata"];
    var imagejson  = fields["imagejson"];
    var remotePath = `${webdavaccess.webdavpath}${whiteboardId}`;

    if(imagedata) {
      if(imagejson) {
        Promise.all([
          imagekit.upload({ file: Buffer.from(imagejson), folder: remotePath, fileName: textfile, useUniqueFileName: 'false' }),
          // imagekit.upload({ file: xss(imagedata), folder: remotePath, fileName: xss(imagefile), useUniqueFileName: 'false' })
        ])
        .then(resp => {
          // console.log(resp)
          resolve(resp[0].name)
        })
        .catch(err => {
          console.log(err)
          reject(err)
        })
      }
      else {
        imagekit.upload({ file: xss(imagedata), folder: remotePath, fileName: xss(imagefile), useUniqueFileName: 'true' })
        .then(resp => {
          console.log(resp)
          resolve(resp.url)
        })
        .catch(err => {
          console.log(err)
        })
      }
    }
    else {
      reject("no imagedata!");
    }
  })
}

function processFormData(req, res) {
  var form = new formidable.IncomingForm(); //Receive form
  var formData = {
      files: {},
      fields: {}
  }
  form.on('file', function (name, file) {
      formData["files"][file.name] = file;
  });
  form.on('field', function (name, value) {
      formData["fields"][name] = value;
  });
  form.on('error', function (err) {
      console.log('File uplaod Error!');
  });
  form.on('end', function () {
    if (accessToken === "" || accessToken == formData["fields"]["at"]) {
      progressUploadFormData(formData)
      .then(data => {
        res.send(data)
      })
      .catch(err => {
        err == '403' ? res.sendStatus(403) : res.sendStatus(500)
      })
    } else {
        res.status(401);  //Unauthorized
        res.end();
    }
    //End file upload
  });
  form.parse(req);
}


//Prevent cross site scripting (xss)
function escapeAllContentStrings(content, cnt) {
    if (!cnt)
        cnt = 0;

    if (typeof (content) === "string") {
        return DOMPurify.sanitize(content);
    }
    for (var i in content) {
        if (typeof (content[i]) === "string") {
            content[i] = DOMPurify.sanitize(content[i]);
        } if (typeof (content[i]) === "object" && cnt < 10) {
            content[i] = escapeAllContentStrings(content[i], ++cnt);
        }
    }
    return content;
}

function getArgs() {
    const args = {}
    process.argv
        .slice(2, process.argv.length)
        .forEach(arg => {
            // long arg
            if (arg.slice(0, 2) === '--') {
                const longArg = arg.split('=')
                args[longArg[0].slice(2, longArg[0].length)] = longArg[1]
            }
            // flags
            else if (arg[0] === '-') {
                const flags = arg.slice(1, arg.length).split('')
                flags.forEach(flag => {
                    args[flag] = true
                })
            }
        })
    return args
}

process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log('unhandledRejection', error.message);
})


var server = require('http').Server(app);
server.listen(PORT);
