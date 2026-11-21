require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// কনফিগারেশন (Render Environment Variables থেকে নেবে)
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'pepe_super_secret_key_2026';
const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY || '';
const PORT = process.env.PORT || 3000;

// রিওয়ার্ড সেটিংস (আপনার পছন্দমতো পরিবর্তন করতে পারবেন)
const AD_REWARD = 100;         // প্রতি এডে ১০০ PEPE
const DAILY_AD_LIMIT = 30;     // ২৪ ঘণ্টায় সর্বোচ্চ ৩০টি এড
const REFERRAL_REWARD = 500;   // প্রতি রেফারে ৫০০ PEPE
const MIN_WITHDRAW = 1000;     // সর্বনিম্ন উইথড্র ১০০০ PEPE

// MongoDB কানেকশন (যাতে ডাটা কখনোই মুছে না যায়)
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully! Data is permanent.'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ইউজার ডাটাবেজ স্কিমা (কোনো ডেমো ডাটা নেই, সব ০ থেকে শুরু হবে)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  adsWatchedToday: { type: Number, default: 0 },
  lastAdReset: { type: Date, default: Date.now },
  completedTasks: [{ type: String }],
  history: [{
    type: { type: String }, // 'Ad', 'Task', 'Referral', 'Withdraw'
    detail: { type: String },
    amount: { type: Number },
    status: { type: String, default: 'Completed' },
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Auth Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'লগইন করা প্রয়োজন!' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'ইউজার পাওয়া যায়নি!' });

    // ২৪ ঘণ্টা পার হলে ডেইলি এড লিমিট রিসেট
    const now = new Date();
    if (now - new Date(user.lastAdReset) >= 24 * 60 * 60 * 1000) {
      user.adsWatchedToday = 0;
      user.lastAdReset = now;
      await user.save();
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'সেশন মেয়াদোত্তীর্ণ, আবার লগইন করুন।' });
  }
};

// ১. রেজিস্ট্রেশন API
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, ref } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'সবগুলো ঘর পূরণ করুন!' });
    }
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ error: 'এই ইমেইল বা ইউজারনেম আগেই ব্যবহৃত হয়েছে!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = username.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(100 + Math.random() * 900);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      balance: 0, // সম্পূর্ণ রিয়েল ০ ব্যালেন্স
      referralCode,
      referredBy: ref || null
    });

    // রেফার বোনাস প্রদান
    if (ref) {
      const referrer = await User.findOne({ referralCode: ref });
      if (referrer) {
        referrer.balance += REFERRAL_REWARD;
        referrer.referralCount += 1;
        referrer.history.unshift({
          type: 'Referral',
          detail: `রেফার বোনাস (${username})`,
          amount: REFERRAL_REWARD,
          status: 'Completed'
        });
        await referrer.save();
      }
    }

    await newUser.save();
    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, message: 'একাউন্ট তৈরি সফল হয়েছে!' });
  } catch (err) {
    res.status(500).json({ error: 'সার্ভার এরর: ' + err.message });
  }
});

// ২. লগইন API
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল!' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল!' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'লগইন সমস্যা হয়েছে!' });
  }
});

// ৩. ড্যাশবোর্ড ডাটা API
app.get('/api/user', auth, async (req, res) => {
  const u = req.user;
  res.json({
    username: u.username,
    email: u.email,
    balance: u.balance,
    referralCode: u.referralCode,
    referralCount: u.referralCount,
    referralReward: REFERRAL_REWARD,
    adsWatchedToday: u.adsWatchedToday,
    dailyAdLimit: DAILY_AD_LIMIT,
    adReward: AD_REWARD,
    completedTasks: u.completedTasks,
    history: u.history
  });
});

// ৪. ১৫-সেকেন্ড এড ক্লাইম API
app.post('/api/ads/claim', auth, async (req, res) => {
  try {
    const { adTitle } = req.body;
    const user = req.user;

    if (user.adsWatchedToday >= DAILY_AD_LIMIT) {
      return res.status(400).json({ error: 'আজকের ৩০টি এডের লিমিট শেষ! ২৪ ঘণ্টা পর আবার দেখুন।' });
    }

    user.balance += AD_REWARD;
    user.adsWatchedToday += 1;
    user.history.unshift({
      type: 'Ad',
      detail: `PTC এড দেখা (${adTitle || 'Sponsored Ad'})`,
      amount: AD_REWARD,
      status: 'Completed'
    });

    await user.save();
    res.json({
      message: `অভিনন্দন! আপনি ${AD_REWARD} PEPE পেয়েছেন।`,
      balance: user.balance,
      adsWatchedToday: user.adsWatchedToday
    });
  } catch (err) {
    res.status(500).json({ error: 'এড ক্লাইম ব্যর্থ হয়েছে!' });
  }
});

// ৫. সোশ্যাল টাস্ক ক্লাইম API
app.post('/api/tasks/claim', auth, async (req, res) => {
  try {
    const { taskId, taskTitle, reward, proof } = req.body;
    const user = req.user;

    if (!proof || proof.trim().length < 3) {
      return res.status(400).json({ error: 'টাস্ক সম্পন্ন করার প্রমাণ (Username/Profile Name) দিন!' });
    }
    if (user.completedTasks.includes(taskId)) {
      return res.status(400).json({ error: 'আপনি এই টাস্কটি আগেই সম্পন্ন করেছেন!' });
    }

    const taskReward = Number(reward) || 250;
    user.completedTasks.push(taskId);
    user.balance += taskReward;
    user.history.unshift({
      type: 'Task',
      detail: `${taskTitle} (ID: ${proof})`,
      amount: taskReward,
      status: 'Completed'
    });

    await user.save();
    res.json({ message: `টাস্ক ভেরিফাইড! ${taskReward} PEPE যোগ হয়েছে।`, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'টাস্ক ক্লাইম সমস্যা হয়েছে!' });
  }
});

// ৬. উইথড্র API (FaucetPay Auto + Binance)
app.post('/api/withdraw', auth, async (req, res) => {
  try {
    const { method, address, amount } = req.body;
    const user = req.user;
    const withdrawAmount = Number(amount);

    if (!address || withdrawAmount < MIN_WITHDRAW) {
      return res.status(400).json({ error: `সর্বনিম্ন উইথড্র ${MIN_WITHDRAW} PEPE এবং সঠিক একাউন্ট দিন!` });
    }
    if (user.balance < withdrawAmount) {
      return res.status(400).json({ error: 'আপনার একাউন্টে পর্যাপ্ত PEPE ব্যালেন্স নেই!' });
    }

    let payoutStatus = 'Pending (Binance)';

    // FaucetPay অটো পেমেন্ট সিস্টেম
    if (method === 'FaucetPay') {
      if (!FAUCETPAY_API_KEY) {
        return res.status(400).json({ error: 'এডমিন এখনো FaucetPay API Key যুক্ত করেননি!' });
      }
      // FaucetPay API কল (1 PEPE = 100000000 Satoshi অনুযায়ী কনভার্ট বা আপনার রেট অনুযায়ী সেট করুন)
      const params = new URLSearchParams();
      params.append('api_key', FAUCETPAY_API_KEY);
      params.append('amount', Math.floor(withdrawAmount * 1000)); // রেট অনুযায়ী অ্যাডজাস্টযোগ্য
      params.append('to', address.trim());
      params.append('currency', 'PEPE');

      const fpRes = await axios.post('https://faucetpay.io/api/v1/send', params);
      if (fpRes.data && fpRes.data.status === 200) {
        payoutStatus = 'Paid (Auto FaucetPay)';
      } else {
        return res.status(400).json({ error: 'FaucetPay এরর: ' + (fpRes.data.message || 'পেমেন্ট পাঠানো যায়নি') });
      }
    }

    // ব্যালেন্স থেকে কেটে নেওয়া এবং হিস্ট্রিতে সেভ করা
    user.balance -= withdrawAmount;
    user.history.unshift({
      type: 'Withdraw',
      detail: `${method} (${address})`,
      amount: -withdrawAmount,
      status: payoutStatus
    });

    await user.save();
    res.json({
      message: method === 'FaucetPay'
        ? `সফল! ${withdrawAmount} PEPE অটোমেটিক আপনার FaucetPay একাউন্টে পাঠানো হয়েছে।`
        : `সফল! আপনার Binance উইথড্র রিকোয়েস্ট (${withdrawAmount} PEPE) গৃহীত হয়েছে।`,
      balance: user.balance
    });
  } catch (err) {
    res.status(500).json({ error: 'উইথড্র প্রসেস ব্যর্থ হয়েছে: ' + err.message });
  }
});

// ফ্রন্টএন্ড সার্ভ করা
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
