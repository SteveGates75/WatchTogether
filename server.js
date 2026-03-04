const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const rooms = {};

io.on("connection", socket => {

  socket.on("join-room", ({ roomId, username }) => {

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) rooms[roomId] = {};

    rooms[roomId][socket.id] = username;

    // send existing users to new user
    socket.emit("existing-users", Object.keys(rooms[roomId]).filter(id => id !== socket.id));

    // notify others
    socket.to(roomId).emit("user-joined", socket.id, username);

    io.to(roomId).emit("user-list", rooms[roomId]);

  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", {
      from: socket.id,
      data
    });
  });

  socket.on("chat-message", msg => {
    io.to(socket.roomId).emit("chat-message", {
      username: socket.username,
      message: msg
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId][socket.id];

    socket.to(roomId).emit("user-left", socket.id);
    io.to(roomId).emit("user-list", rooms[roomId]);

    if (Object.keys(rooms[roomId]).length === 0) {
      delete rooms[roomId];
    }
  });

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Running on " + PORT));