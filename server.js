const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

io.on("connection", socket => {
  console.log("User connected");

  socket.on("chat", msg => {
    io.emit("chat", msg);
  });
});

http.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
