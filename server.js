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

const users = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (username) => {
    users[socket.id] = { id: socket.id, username: username };
    io.emit('user-joined', `${username} joined the chat`);
  });

  socket.on('send-message', (data) => {
    const user = users[socket.id];
    if (user) {
      io.emit('new-message', {
        user: user.username,
        message: data.message,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  // WebRTC signaling (audio/video calls) – FIXED
  socket.on('offer', (data) => {
    // Broadcast offer to all other clients
    socket.broadcast.emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    // Send answer to specific target
    io.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    // Send ICE candidate to specific target
    io.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Screen share signaling – FIXED
  socket.on('screen-offer', (data) => {
    socket.broadcast.emit('screen-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('screen-answer', (data) => {
    io.to(data.target).emit('screen-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('screen-ice-candidate', (data) => {
    io.to(data.target).emit('screen-ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('screen-started', () => {
    socket.broadcast.emit('screen-available', {
      sharer: socket.id,
      username: users[socket.id]?.username
    });
  });

  socket.on('screen-stopped', () => {
    socket.broadcast.emit('screen-unavailable');
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.emit('user-left', `${user.username} left the chat`);
      delete users[socket.id];
    }
    socket.broadcast.emit('screen-unavailable');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});