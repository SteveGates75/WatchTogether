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

// Store connected users
const users = {};
let roomUsers = [];

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // Handle user joining with username
  socket.on('join', (username) => {
    users[socket.id] = {
      id: socket.id,
      username: username
    };
    
    io.emit('user-joined', {
      user: users[socket.id],
      message: `${username} joined the chat`
    });
  });

  // Handle text messages
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

  // Room management for calls/shares
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    roomUsers.push(socket.id);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined-room', socket.id);
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    roomUsers = roomUsers.filter(id => id !== socket.id);
    socket.to(roomId).emit('user-left-room', socket.id);
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.emit('user-left', {
        user: user,
        message: `${user.username} left the chat`
      });
      
      delete users[socket.id];
    }
    
    // Remove from room and notify others
    if (roomUsers.includes(socket.id)) {
      roomUsers = roomUsers.filter(id => id !== socket.id);
      io.to('main-room').emit('user-left-room', socket.id);
    }
    
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});