const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const { v4: uuidv4 } = require("uuid");

app.use(express.static("public"));

// Rooms storage
const rooms = {};

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.username = username;
    socket.roomId = roomId;

    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = username;

    // Send existing users to new user
    socket.emit(
      "existing-users",
      Object.keys(rooms[roomId]).filter(id => id !== socket.id)
    );

    // Notify others
    socket.to(roomId).emit("user-joined", socket.id, username);

    // Update user list
    io.to(roomId).emit("user-list", rooms[roomId]);
  });

  // WebRTC signaling
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // Chat messages
  socket.on("chat-message", msg => {
    io.to(socket.roomId).emit("chat-message", {
      username: socket.username,
      message: msg
    });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId][socket.id];

    socket.to(roomId).emit("user-left", socket.id);
    io.to(roomId).emit("user-list", rooms[roomId]);

    if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on port " + PORT));