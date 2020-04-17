var PORT = 8080; //Set port for the app
var accessToken = ""; //Can be set here or as start parameter (node server.js --accesstoken=MYTOKEN)
var disableSmallestScreen = false; //Can be set to true if you dont want to show (node server.js --disablesmallestscreen=true)
var webdav = false; //Can be set to true if you want to allow webdav save (node server.js --webdav=true)

var fs = require("fs-extra");
var fsp = require("fs-extra-promise");
var express = require('express');
var formidable = require('formidable'); //form upload processing
var PubNub = require('pubnub');

const createDOMPurify = require('dompurify'); //Prevent xss
const { JSDOM } = require('jsdom');
const window = (new JSDOM('')).window;
const DOMPurify = createDOMPurify(window);

const { createClient } = require("webdav");

var s_whiteboard = require("./s_whiteboard.js");

var app = express();
app.use(express.static(__dirname + '/public'));
var server = require('http').Server(app);
server.listen(PORT);

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

var pubnub = new PubNub({
  publishKey: 'pub-c-1be4bf40-5cf0-4daa-995c-592ef7e5b160',
  subscribeKey: 'sub-c-e10759f2-730c-11ea-bbea-a6250b4fd944',
  uuid: "74a4a45c-7bee-4fbc-b197-d74dfa11b7f8",
  // ssl: true
})

pubnub.addListener({
  message: function(message) {
    handleMessageEvents(message);
  }
})

function publish(payload) {
  pubnub.publish({
     channel: whiteboardId,
     message: payload
   },
   (status, response) => {
     if(status.statusCode !== 200) {
       console.error('error publishing whiteboard events')
     }
   });
}

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

// app.get('/loadwhiteboard', function (req, res) {
//     var wid = req["query"]["wid"];
//     var at = req["query"]["at"]; //accesstoken
//     if (accessToken === "" || accessToken == at) {
//         var ret = s_whiteboard.loadStoredData(wid);
//         res.send(ret);
//         res.end();
//     } else {
//         res.status(401);  //Unauthorized
//         res.end();
//     }
// });

app.get('/loadwhiteboard', function (req, res) {
  var whiteboardId = req["query"]["wid"];
  var at = req["query"]["at"]

  if(accessToken === "" || accessToken == at) {
    client.getFileContents(`${webdavaccess.webdavpath}${whiteboardId}.json`, { format: "text" })
    .then(data => {
      if(data) {
        data = JSON.parse(data)
      }
      else {
        data = []
      }
      res.status(200).send(data)
    })
    .catch(err => {
      console.log(err.response)

      res.status(404).send(err)
    })
  }
  else {
    res.sendStatus(500)
  }
})

app.post('/upload', function (req, res) { //File upload
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
          .then(() => {
            res.send('done')
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
});

function progressUploadFormData(formData) {
  return new Promise((resolve, reject) => {
    console.log("Progress new Form Data");
    var fields = escapeAllContentStrings(formData.fields);
    var files = formData.files;
    var whiteboardId = fields["whiteboardId"];

    var name = fields["name"] || "";
    var date = fields["date"] || (+new Date());
    var imagefile = `${whiteboardId}.png`;
    var jsonfile  = `${whiteboardId}.json`;

    fs.ensureDir("./public/uploads", function (err) {
        if (err) {
            console.log("Could not create upload folder!", err);
            return;
        }
        var imagedata = fields["imagedata"];
        var imagejson = fields["imagejson"];
        var imagepath = './public/uploads';

        if ((imagedata && imagedata != "") && imagejson) { //Save from base64 data
            imagedata = imagedata.replace(/^data:image\/png;base64,/, "").replace(/^data:image\/jpeg;base64,/, "");

            Promise.all([
              fsp.writeFile(`${imagepath}/${imagefile}`, imagedata, 'base64'),
              fsp.writeFile(`${imagepath}/${jsonfile}`,  JSON.stringify(imagejson, null, 2))
            ])
            .then(() => {
              if (webdavaccess) {
                fs.createReadStream(`${imagepath}/${imagefile}`)
                  .pipe(client.createWriteStream(`${webdavaccess.webdavpath}${imagefile}`));

                fs.createReadStream(`${imagepath}/${jsonfile}`)
                  .pipe(client.createWriteStream(`${webdavaccess.webdavpath}${jsonfile}`));

                resolve()
              }
              else {
                reject("Webdav is not enabled on the server!");
              }
            })
            .catch(err => {
              console.log("error", err);
              reject(err);
            })
        } else {
            reject("no imagedata!");
            console.log("No image Data found for this upload!", name);
        }
    });
  })
}

var smallestScreenResolutions = {};

function handleMessageEvents(obj) {
    var whiteboardId = null

    if (!obj || !obj.message) return;
    obj = obj.message

    let content;

    Object.keys(obj).forEach(action => {
      content = obj[action];

      switch(action) {
        case 'disconnect':
        if (smallestScreenResolutions && smallestScreenResolutions[whiteboardId] && socket && socket.id) {
            delete smallestScreenResolutions[whiteboardId][socket.id];
        }
        publish({'refreshUserBadges': null}); //Removes old user Badges
        sendSmallestScreenResolution();
        break;

        case 'drawToWhiteboard':
        content = escapeAllContentStrings(content);
        if (accessToken === "" || accessToken == content["at"]) {
            publish({'drawToWhiteboard': content}); //Send to all users in the room (not own socket)
            s_whiteboard.handleEventsAndData(content); //save whiteboardchanges on the server
        } else {
            publish({'wrongAccessToken': true});
        }
        break;

        case 'joinWhiteboard':
        content = escapeAllContentStrings(content);
        if (accessToken === "" || accessToken == content["at"]) {
            whiteboardId = content["wid"];

            pubnub.subscribe({
              channels: [whiteboardId],
              withPresence: false,
            });

            smallestScreenResolutions[whiteboardId] = smallestScreenResolutions[whiteboardId] ? smallestScreenResolutions[whiteboardId] : {};
            // smallestScreenResolutions[whiteboardId][socket.id] = content["windowWidthHeight"] || { w: 10000, h: 10000 };
            sendSmallestScreenResolution();
        } else {
            publish({'wrongAccessToken': true});
        }
        break;

        case 'updateScreenResolution':
        content = escapeAllContentStrings(content);
        if (accessToken === "" || accessToken == content["at"]) {
            smallestScreenResolutions[whiteboardId][socket.id] = content["windowWidthHeight"] || { w: 10000, h: 10000 };
            sendSmallestScreenResolution();
        }
        break;
      }
    })
  };

  function sendSmallestScreenResolution() {
      if (disableSmallestScreen) {
          return;
      }
      var smallestWidth = 10000;
      var smallestHeight = 10000;
      for (var i in smallestScreenResolutions[whiteboardId]) {
          smallestWidth = smallestWidth > smallestScreenResolutions[whiteboardId][i]["w"] ? smallestScreenResolutions[whiteboardId][i]["w"] : smallestWidth;
          smallestHeight = smallestHeight > smallestScreenResolutions[whiteboardId][i]["h"] ? smallestScreenResolutions[whiteboardId][i]["h"] : smallestHeight;
      }
      publish({ 'updateSmallestScreenResolution': { w: smallestWidth, h: smallestHeight } })
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
