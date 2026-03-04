const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const rooms = {}; // roomId -> { users: { socketId: username }, screenSharer: socketId }

io.on("connection", socket => {

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) rooms[roomId] = { users: {}, screenSharer: null };
    rooms[roomId].users[socket.id] = username;

    // send existing users to new user
    socket.emit("existing-users", Object.keys(rooms[roomId].users).filter(id => id !== socket.id));

    // notify others
    socket.to(roomId).emit("user-joined", socket.id, username);

    // send screen info if active
    if (rooms[roomId].screenSharer) socket.emit("screen-started", rooms[roomId].screenSharer);

    io.to(roomId).emit("user-list", rooms[roomId].users);

    // handle WebRTC signals
    socket.on("signal", ({ to, data }) => {
      io.to(to).emit("signal", { from: socket.id, data });
    });

    // handle chat
    socket.on("chat-message", msg => {
      io.to(roomId).emit("chat-message", { username: socket.username, message: msg });
    });

    // screen share
    socket.on("start-screen", () => {
      rooms[roomId].screenSharer = socket.id;
      io.to(roomId).emit("screen-started", socket.id);
    });

    socket.on("stop-screen", () => {
      if (rooms[roomId].screenSharer === socket.id) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit("screen-stopped");
      }
    });

    socket.on("disconnect", () => {
      delete rooms[roomId]?.users[socket.id];
      if (rooms[roomId]?.screenSharer === socket.id) {
        rooms[roomId].screenSharer = null;
        io.to(roomId).emit("screen-stopped");
      }
      io.to(roomId).emit("user-list", rooms[roomId]?.users);
      if (Object.keys(rooms[roomId]?.users || {}).length === 0) delete rooms[roomId];
    });
  });

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on port " + PORT));