const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map(); // socketId -> username

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  socket.on('join', (username) => {
    users.set(socket.id, username);
    console.log(`${username} joined`);
    // Send the list of existing users to the new user
    const userList = Array.from(users.entries()).map(([id, name]) => ({ id, name }));
    socket.emit('user-list', userList);
    // Notify others that a new user joined
    socket.broadcast.emit('user-joined', { id: socket.id, username });
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    console.log(`📤 Offer from ${socket.id} to ${data.targetId}`);
    io.to(data.targetId).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log(`📤 Answer from ${socket.id} to ${data.targetId}`);
    io.to(data.targetId).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log(`❄️ ICE candidate from ${socket.id} to ${data.targetId}`);
    io.to(data.targetId).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      console.log(`${username} disconnected`);
      users.delete(socket.id);
      io.emit('user-left', { id: socket.id, username });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});