const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const { v4: uuidv4 } = require("uuid");

app.use(express.static("public"));

const rooms = {};

io.on("connection", socket => {

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);

    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) {
      rooms[roomId] = { users: {}, screenSharer: null };
    }

    rooms[roomId].users[socket.id] = username;

    io.to(roomId).emit("user-list", rooms[roomId].users);
    socket.to(roomId).emit("user-connected", socket.id);

    socket.on("signal", data => {
      io.to(data.to).emit("signal", {
        from: socket.id,
        signal: data.signal
      });
    });

    socket.on("start-screen", () => {
      rooms[roomId].screenSharer = socket.id;
      io.to(roomId).emit("screen-started", socket.id);
    });

    socket.on("stop-screen", () => {
      rooms[roomId].screenSharer = null;
      io.to(roomId).emit("screen-stopped");
    });

    socket.on("disconnect", () => {
      delete rooms[roomId]?.users[socket.id];

      if (rooms[roomId]?.screenSharer === socket.id) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit("screen-stopped");
      }

      io.to(roomId).emit("user-list", rooms[roomId]?.users);
    });
  });

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Running on ${PORT}`));