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

var webdavaccess = {
  webdavserver: 'https://cloud.ruptive.cx/remote.php/dav/files/whiteboard/',
  webdavpath: '/whiteboards/',
  webdavusername: 'whiteboard',
  webdavpassword: 'whiteboard'
}

var client = createClient(
  webdavaccess.webdavserver,
  {
    username: webdavaccess.webdavusername,
    password: webdavaccess.webdavpassword
  }
)

if (process.env.accesstoken) {
    accessToken = process.env.accesstoken;
}
if (process.env.disablesmallestscreen) {
    disablesmallestscreen = true;
}
if (process.env.webdav) {
    webdav = true;
}

var startArgs = getArgs();
if (startArgs["accesstoken"]) {
    accessToken = startArgs["accesstoken"];
}
if (startArgs["disablesmallestscreen"]) {
    disableSmallestScreen = true;
}
if (startArgs["webdav"]) {
    webdav = true;
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

app.get('/loadwhiteboard', function (req, res) {
  var remotePath = `${webdavaccess.webdavpath}${whiteboardId}`;
  var whiteboardId = req["query"]["wid"];
  var at = req["query"]["at"]

  if(accessToken === "" || accessToken == at) {
    request(`https://ik.imagekit.io/ruptive/whiteboards/${whiteboardId}/${whiteboardId}.txt`, (error, response, body) => {
      if(body && body !== 'Not Found') {

        res.status(200).send(JSON.parse(body))
      }
      else {
        console.log(error)

        res.status(200).send('no file')
      }
    });
  }
  else {
    res.sendStatus(500)
  }
})

app.post('/save', function (req, res) { //File upload
  return processFormData(req, res)
});

app.post('/upload', function (req, res) { //File upload
  return processFormData(req, res)
});

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

function progressUploadFormData(formData) {
  return new Promise((resolve, reject) => {
    var imagekit = new ImageKit({
      publicKey:   "public_SFl3jDcVhbQORQSOwx8dHFFJsTU=",
      privateKey:  "private_vwkG8Nbvaj4FyQaxH6RwUEdFtjw=",
      urlEndpoint: "https://ik.imagekit.io/ruptive"
    });

    var whiteboardId = formData.fields["whiteboardId"];
    var fields = escapeAllContentStrings(formData.fields);
    var files = formData.files;

    var date = fields["date"] || (+new Date());

    var imagefile = `${fields["name"] || whiteboardId}.png`;
    var textfile  = `${whiteboardId}.txt`;

    var imagedata  = fields["imagedata"];
    var imagejson  = fields["imagejson"];
    var remotePath = `${webdavaccess.webdavpath}${whiteboardId}`;

    if(imagedata) {
      if(imagejson) {
        Promise.all([
          imagekit.upload({ file: Buffer.from(imagejson), folder: remotePath, fileName: textfile, useUniqueFileName: 'false' }),
          imagekit.upload({ file: xss(imagedata), folder: remotePath, fileName: xss(imagefile), useUniqueFileName: 'false' })
        ])
        .then(resp => {
          console.log(resp)
          resolve('files uploaded')
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
