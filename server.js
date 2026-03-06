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
  },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

const users = {};
let roomUsers = [];
let screenShareInfo = {
  active: false,
  sharer: null,
  sharerUsername: null
};

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);
  console.log('Transport:', socket.conn.transport.name);

  socket.conn.on('upgrade', (transport) => {
    console.log('Transport upgraded to:', transport.name);
  });

  socket.on('join', (username) => {
    users[socket.id] = {
      id: socket.id,
      username: username
    };
    
    io.emit('user-joined', {
      user: users[socket.id],
      message: `${username} joined the chat`
    });

    // Send current screen share status to new user
    if (screenShareInfo.active) {
      socket.emit('screen-sharing-started', {
        sharer: screenShareInfo.sharer,
        username: screenShareInfo.sharerUsername
      });
    }
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

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    roomUsers.push(socket.id);
    socket.to(roomId).emit('user-joined-room', socket.id);
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    roomUsers = roomUsers.filter(id => id !== socket.id);
    socket.to(roomId).emit('user-left-room', socket.id);
  });

  // Screen sharing status
  socket.on('screen-sharing-started', (data) => {
    screenShareInfo = {
      active: true,
      sharer: socket.id,
      sharerUsername: data.username
    };
    socket.broadcast.emit('screen-sharing-started', data);
  });

  socket.on('screen-sharing-stopped', () => {
    screenShareInfo = {
      active: false,
      sharer: null,
      sharerUsername: null
    };
    socket.broadcast.emit('screen-sharing-stopped');
  });

  socket.on('request-screen-join', (data) => {
    // Forward request to the screen sharer
    io.to(data.target).emit('request-screen-join', {
      requester: socket.id
    });
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

  // Screen sharing signaling
  socket.on('screen-offer', (data) => {
    socket.to(data.target).emit('screen-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('screen-answer', (data) => {
    socket.to(data.target).emit('screen-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('screen-ice-candidate', (data) => {
    socket.to(data.target).emit('screen-ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.emit('user-left', {
        user: user,
        message: `${user.username} left the chat`
      });
      
      delete users[socket.id];
    }
    
    // If screen sharer disconnects, notify everyone
    if (screenShareInfo.sharer === socket.id) {
      screenShareInfo = {
        active: false,
        sharer: null,
        sharerUsername: null
      };
      socket.broadcast.emit('screen-sharing-stopped');
    }
    
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