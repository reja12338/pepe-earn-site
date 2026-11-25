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
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const ENV_FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY || '';
const PORT = process.env.PORT || 3000;

// ১ ফুল PEPE টোকেন = 100,000,000 FaucetPay সাতোশি ইউনিট
const FAUCETPAY_SATOSHI_PER_PEPE = 100000000;

// MongoDB কানেকশন
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected Successfully! Data is permanent.');
    await ensureDefaultSettings();
  })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Schemas ---
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global_config' },
  adReward: { type: Number, default: 100 },
  dailyAdLimit: { type: Number, default: 30 },
  minWithdraw: { type: Number, default: 10 },
  signUpBonus: { type: Number, default: 100 },
  dailyBonusPepe: { type: Number, default: 50 },
  ptcAdCreateCost: { type: Number, default: 500 },
  couponChannelLink: { type: String, default: '' },
  faucetpay: {
    enabled: { type: Boolean, default: true },
    apiKey: { type: String, default: '' },
    minWithdraw: { type: Number, default: 10 },
    rateMultiplier: { type: Number, default: 1 }
  },
  binance: {
    enabled: { type: Boolean, default: true },
    minWithdraw: { type: Number, default: 500 },
    inputMode: { type: String, enum: ['uid', 'address_network', 'both'], default: 'uid' },
    fieldLabel: { type: String, default: 'Binance UID / Pay ID' },
    fieldPlaceholder: { type: String, default: 'Enter your Binance UID or Pay ID' }
  },
  referral: {
    enabled: { type: Boolean, default: true },
    bonusPepe: { type: Number, default: 500 }
  },
  security: {
    oneAccountPerDevice: { type: Boolean, default: true },
    oneAccountPerIp: { type: Boolean, default: true }
  }
}, { timestamps: true });

const adSchema = new mongoose.Schema({
  title: { type: String, required: true },
  url: { type: String, required: true },
  durationSec: { type: Number, default: 15 },
  rewardPepe: { type: Number, default: 100 },
  createdBy: { type: String, default: 'admin' },
  status: { type: String, enum: ['active', 'pending'], default: 'active' }
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  platform: { type: String, enum: ['Telegram', 'YouTube', 'Facebook', 'Ad Network'], default: 'Telegram' },
  title: { type: String, required: true },
  link: { type: String, required: true },
  rewardPepe: { type: Number, default: 250 }
}, { timestamps: true });

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  channelLink: { type: String, default: '' },
  rewardPepe: { type: Number, required: true },
  maxUses: { type: Number, default: 100 },
  usedCount: { type: Number, default: 0 },
  usedBy: [{ type: String }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const depositSchema = new mongoose.Schema({
  refId: { type: String, default: '' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String, required: true },
  method: { type: String, default: 'FaucetPay / Binance' },
  txId: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  depositBalance: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  deviceId: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  adsWatchedToday: { type: Number, default: 0 },
  lastAdReset: { type: Date, default: Date.now },
  lastDailyBonus: { type: Date, default: null },
  completedTasks: [{ type: String }],
  history: [{
    refId: { type: String, default: '' },
    type: { type: String },
    detail: { type: String },
    amount: { type: Number },
    status: { type: String, default: 'Completed' },
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const withdrawalSchema = new mongoose.Schema({
  refId: { type: String, default: '' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String, required: true },
  method: { type: String, enum: ['faucetpay', 'binance'], required: true },
  destination: { type: String, required: true },
  network: { type: String, default: '' },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);
const Ad = mongoose.model('Ad', adSchema);
const Task = mongoose.model('Task', taskSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const User = mongoose.model('User', userSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

async function ensureDefaultSettings() {
  const existing = await Settings.findOne({ key: 'global_config' });
  if (!existing) {
    await Settings.create({ key: 'global_config' });
  }
}

async function getConfig() {
  await ensureDefaultSettings();
  return Settings.findOne({ key: 'global_config' });
}

// --- FaucetPay Exact Token Payout Helper ---
async function sendFaucetPayExactPepe(apiKey, toAddress, pepeTokens, rateMultiplier = 1) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('অ্যাডমিন প্যানেল বা Render-এ FaucetPay API Key সেট করা নেই!');
  }

  // যদি কেউ ভুল করে 1000 দিয়ে রাখে, তবে 1 ধরে নেবে যাতে 10 টোকেন = ঠিক 10 PEPE যায়
  const effectiveMult = (!rateMultiplier || Number(rateMultiplier) === 1000) ? 1 : Number(rateMultiplier);
  const satoshiAmount = Math.round(Number(pepeTokens) * effectiveMult * FAUCETPAY_SATOSHI_PER_PEPE);

  if (!Number.isFinite(satoshiAmount) || satoshiAmount <= 0) {
    throw new Error('সঠিক PEPE পরিমাণ দিন!');
  }

  const params = new URLSearchParams();
  params.append('api_key', cleanKey);
  params.append('amount', String(satoshiAmount));
  params.append('to', String(toAddress).trim());
  params.append('currency', 'PEPE');

  const fpRes = await axios.post('https://faucetpay.io/api/v1/send', params);
  if (!fpRes.data || fpRes.data.status !== 200) {
    throw new Error(fpRes.data?.message || 'FaucetPay পেমেন্ট পাঠানো যায়নি');
  }
  return fpRes.data;
}

// --- User Auth Middleware ---
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'লগইন করা প্রয়োজন!' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'ইউজার পাওয়া যায়নি!' });
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'আপনার একাউন্ট ব্লক করা হয়েছে!' });
    }

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

// --- Admin PIN Middleware ---
function requireAdminPin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.adminPin || req.query?.pin;
  if (String(pin || '') !== String(ADMIN_PIN)) {
    return res.status(401).json({ ok: false, message: 'ভুল অ্যাডমিন PIN' });
  }
  next();
}

// --- User APIs ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, ref, deviceId } = req.body;
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const cfg = await getConfig();

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required!' });
    }

    if (cfg?.security?.oneAccountPerDevice && deviceId) {
      const devExists = await User.findOne({ deviceId: String(deviceId).trim() });
      if (devExists) {
        return res.status(400).json({ error: 'An account already exists on this device!' });
      }
    }

    if (cfg?.security?.oneAccountPerIp && clientIp) {
      const ipExists = await User.findOne({ ipAddress: clientIp });
      if (ipExists) {
        return res.status(400).json({ error: 'An account already exists on this network / IP!' });
      }
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }] });
    if (existing) {
      return res.status(400).json({ error: 'Email or username is already registered!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = username.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(100 + Math.random() * 900);
    const signUpBonus = Number(cfg?.signUpBonus ?? 100);
    const initialHistory = [];

    if (signUpBonus > 0) {
      initialHistory.push({
        type: 'Sign Up Bonus',
        detail: 'Welcome Sign-Up Bonus',
        amount: signUpBonus,
        status: 'Completed'
      });
    }

    const newUser = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      balance: signUpBonus,
      deviceId: (deviceId || '').trim(),
      ipAddress: clientIp,
      referralCode,
      referredBy: ref || null,
      history: initialHistory
    });

    if (ref && cfg?.referral?.enabled) {
      const referrer = await User.findOne({ referralCode: ref });
      if (referrer) {
        const bonus = Number(cfg.referral.bonusPepe) || 500;
        referrer.balance += bonus;
        referrer.referralCount += 1;
        referrer.history.unshift({
          type: 'Referral',
          detail: `Referral bonus (${username})`,
          amount: bonus,
          status: 'Completed'
        });
        await referrer.save();
      }
    }

    await newUser.save();
    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      message: signUpBonus > 0
        ? `Account created! You received ${signUpBonus} PEPE sign-up bonus.`
        : 'Account created successfully!'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase().trim() });
    if (!user) return res.status(400).json({ error: 'Invalid email or password!' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Your account has been blocked!' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid email or password!' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed!' });
  }
});

app.get('/api/user', auth, async (req, res) => {
  const u = req.user;
  const cfg = await getConfig();
  const [ads, tasks, latestCoupon] = await Promise.all([
    Ad.find({ status: { $ne: 'pending' } }).sort({ createdAt: -1 }),
    Task.find().sort({ createdAt: -1 }),
    Coupon.findOne({ active: true }).sort({ createdAt: -1 })
  ]);

  const now = Date.now();
  const lastBonusMs = u.lastDailyBonus ? new Date(u.lastDailyBonus).getTime() : 0;
  const cooldownMs = 24 * 60 * 60 * 1000;
  const canClaimDailyBonus = !lastBonusMs || (now - lastBonusMs >= cooldownMs);
  const nextDailyBonusAt = canClaimDailyBonus ? now : lastBonusMs + cooldownMs;
  const couponChannelLink = String(latestCoupon?.channelLink || cfg?.couponChannelLink || '').trim();

  res.json({
    username: u.username,
    email: u.email,
    balance: u.balance,
    depositBalance: u.depositBalance || 0,
    referralCode: u.referralCode,
    referralCount: u.referralCount,
    referralReward: cfg?.referral?.bonusPepe ?? 500,
    signUpBonus: cfg?.signUpBonus ?? 100,
    dailyBonusPepe: cfg?.dailyBonusPepe ?? 50,
    ptcAdCreateCost: cfg?.ptcAdCreateCost ?? 500,
    couponChannelLink,
    canClaimDailyBonus,
    nextDailyBonusAt,
    adsWatchedToday: u.adsWatchedToday,
    dailyAdLimit: cfg?.dailyAdLimit ?? 30,
    adReward: cfg?.adReward ?? 100,
    ads,
    tasks,
    completedTasks: u.completedTasks,
    history: u.history,
    withdrawConfig: {
      minWithdraw: cfg?.minWithdraw ?? 10,
      faucetpay: cfg?.faucetpay,
      binance: cfg?.binance
    }
  });
});

app.post('/api/bonus/daily', auth, async (req, res) => {
  try {
    const user = req.user;
    const cfg = await getConfig();
    const now = new Date();
    const cooldownMs = 24 * 60 * 60 * 1000;

    if (user.lastDailyBonus && (now - new Date(user.lastDailyBonus)) < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - (now - new Date(user.lastDailyBonus))) / 1000);
      const hours = Math.floor(remainingSec / 3600);
      const mins = Math.floor((remainingSec % 3600) / 60);
      return res.status(400).json({ error: `Daily bonus already claimed! Come back in ${hours}h ${mins}m.` });
    }

    const reward = Number(cfg?.dailyBonusPepe ?? 50);
    user.balance += reward;
    user.lastDailyBonus = now;
    user.history.unshift({
      type: 'Daily Bonus',
      detail: '24h Daily Check-In Bonus',
      amount: reward,
      status: 'Completed'
    });
    await user.save();

    res.json({
      message: `Daily bonus claimed! +${reward} PEPE added to your balance.`,
      balance: user.balance
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim daily bonus!' });
  }
});

app.post('/api/coupons/redeem', auth, async (req, res) => {
  try {
    const rawCode = String(req.body?.code || '').trim().toUpperCase();
    if (!rawCode) {
      return res.status(400).json({ error: 'Please enter a coupon code!' });
    }

    const coupon = await Coupon.findOne({ code: rawCode });
    if (!coupon || !coupon.active) {
      return res.status(404).json({ error: 'Invalid or inactive coupon code!' });
    }
    if (coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ error: 'This coupon has reached its usage limit!' });
    }
    if (Array.isArray(coupon.usedBy) && coupon.usedBy.includes(String(req.user._id))) {
      return res.status(400).json({ error: 'You have already redeemed this coupon!' });
    }

    const reward = Number(coupon.rewardPepe) || 0;
    coupon.usedCount += 1;
    coupon.usedBy.push(String(req.user._id));
    await coupon.save();

    req.user.balance += reward;
    req.user.history.unshift({
      type: 'Coupon',
      detail: `Redeemed Coupon (${coupon.code})`,
      amount: reward,
      status: 'Completed'
    });
    await req.user.save();

    res.json({
      message: `Coupon ${coupon.code} redeemed! +${reward} PEPE added.`,
      balance: req.user.balance
    });
  } catch (err) {
    res.status(500).json({ error: 'Coupon redemption failed!' });
  }
});

app.post('/api/deposit/request', auth, async (req, res) => {
  try {
    const { method, txId, amount } = req.body;
    const numAmount = Number(amount);
    const cleanTx = String(txId || '').trim();

    if (!cleanTx || !Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid amount and transaction ID!' });
    }

    const refId = 'dep_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);
    await Deposit.create({
      refId,
      userId: req.user._id,
      username: req.user.username,
      method: String(method || 'FaucetPay / Binance').trim(),
      txId: cleanTx,
      amount: numAmount,
      status: 'pending'
    });

    req.user.history.unshift({
      refId,
      type: 'Deposit',
      detail: `Deposit (${method || 'Wallet'}) - ${cleanTx}`,
      amount: numAmount,
      status: 'Pending Approval'
    });
    await req.user.save();

    res.json({ message: 'Deposit request submitted! Balance will be credited after admin approval.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit deposit request!' });
  }
});

app.post('/api/ads/submit', auth, async (req, res) => {
  try {
    const { title, url, durationSec, rewardPepe } = req.body;
    const cfg = await getConfig();
    const cost = Number(cfg?.ptcAdCreateCost ?? 500);

    const cleanTitle = String(title || '').trim();
    const cleanUrl = String(url || '').trim();
    if (!cleanTitle || !cleanUrl) {
      return res.status(400).json({ error: 'Ad title and target URL are required!' });
    }

    const totalAvailable = Number(req.user.depositBalance || 0) + Number(req.user.balance || 0);
    if (totalAvailable < cost) {
      return res.status(400).json({ error: `Insufficient funds! Creating a PTC ad costs ${cost} PEPE.` });
    }

    if (Number(req.user.depositBalance || 0) >= cost) {
      req.user.depositBalance = Number(req.user.depositBalance || 0) - cost;
    } else {
      const fromDeposit = Number(req.user.depositBalance || 0);
      const fromMain = cost - fromDeposit;
      req.user.depositBalance = 0;
      req.user.balance = Math.max(0, Number(req.user.balance || 0) - fromMain);
    }

    req.user.history.unshift({
      type: 'PTC Advertising',
      detail: `Submitted Ad: ${cleanTitle}`,
      amount: -cost,
      status: 'Active'
    });
    await req.user.save();

    const createdAd = await Ad.create({
      title: cleanTitle,
      url: cleanUrl,
      durationSec: Math.max(5, Number(durationSec) || 15),
      rewardPepe: Math.max(1, Number(rewardPepe) || Number(cfg?.adReward) || 100),
      createdBy: req.user.username,
      status: 'active'
    });

    res.json({
      message: `Your PTC ad "${cleanTitle}" is now live!`,
      ad: createdAd,
      balance: req.user.balance,
      depositBalance: req.user.depositBalance
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish PTC ad!' });
  }
});

app.post('/api/ads/claim', auth, async (req, res) => {
  try {
    const { adId, adTitle } = req.body;
    const user = req.user;
    const cfg = await getConfig();
    const limit = Number(cfg?.dailyAdLimit) || 30;

    if (user.adsWatchedToday >= limit) {
      return res.status(400).json({ error: `Daily limit of ${limit} ads reached! Try again in 24 hours.` });
    }

    let reward = Number(cfg?.adReward) || 100;
    let title = adTitle || 'Sponsored Ad';

    if (adId) {
      const foundAd = await Ad.findById(adId);
      if (foundAd) {
        reward = Number(foundAd.rewardPepe) || reward;
        title = foundAd.title;
      }
    }

    user.balance += reward;
    user.adsWatchedToday += 1;
    user.history.unshift({
      type: 'Ad',
      detail: `PTC Ad (${title})`,
      amount: reward,
      status: 'Completed'
    });

    await user.save();
    res.json({
      message: `Congratulations! You earned ${reward} PEPE.`,
      balance: user.balance,
      adsWatchedToday: user.adsWatchedToday
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim ad reward!' });
  }
});

app.post('/api/tasks/claim', auth, async (req, res) => {
  try {
    const { taskId, taskTitle, reward, proof } = req.body;
    const user = req.user;

    if (!proof || proof.trim().length < 2) {
      return res.status(400).json({ error: 'Please provide your task proof (Username/Profile Name)!' });
    }
    if (taskId && user.completedTasks.includes(String(taskId))) {
      return res.status(400).json({ error: 'You have already completed this task!' });
    }

    let taskReward = Number(reward) || 250;
    let title = taskTitle || 'Social Task';
    if (taskId) {
      const foundTask = await Task.findById(taskId);
      if (foundTask) {
        taskReward = Number(foundTask.rewardPepe) || taskReward;
        title = foundTask.title;
      }
    }

    if (taskId) user.completedTasks.push(String(taskId));
    user.balance += taskReward;
    user.history.unshift({
      type: 'Task',
      detail: `${title} (ID: ${proof.trim()})`,
      amount: taskReward,
      status: 'Completed'
    });

    await user.save();
    res.json({ message: `Task verified! ${taskReward} PEPE credited.`, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Task claim failed!' });
  }
});

// --- উইথড্র API (FaucetPay Exact 10 PEPE = 10 PEPE + Binance) ---
app.post('/api/withdraw', auth, async (req, res) => {
  try {
    const { method, address, network, amount } = req.body;
    const user = req.user;
    const cfg = await getConfig();
    const withdrawAmount = Number(amount);
    const normalizedMethod = String(method || '').toLowerCase() === 'faucetpay' ? 'faucetpay' : 'binance';

    const minLimit = normalizedMethod === 'faucetpay'
      ? Number(cfg?.faucetpay?.minWithdraw || 10)
      : Number(cfg?.binance?.minWithdraw || 500);

    if (!address || !withdrawAmount || withdrawAmount < minLimit) {
      return res.status(400).json({ error: `Minimum withdrawal is ${minLimit} PEPE and a valid destination is required!` });
    }
    if (user.balance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient PEPE balance!' });
    }

    const refId = 'wd_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);
    let payoutStatus = 'pending';
    let historyStatus = normalizedMethod === 'faucetpay' ? 'Pending (FaucetPay)' : 'Pending (Binance)';

    if (normalizedMethod === 'faucetpay') {
      const fpKey = (cfg?.faucetpay?.apiKey || ENV_FAUCETPAY_API_KEY || '').trim();
      if (cfg?.faucetpay?.enabled && fpKey) {
        try {
          await sendFaucetPayExactPepe(fpKey, address.trim(), withdrawAmount, cfg?.faucetpay?.rateMultiplier || 1);
          payoutStatus = 'approved';
          historyStatus = 'Confirmed (Paid via FaucetPay)';
        } catch (fpErr) {
          return res.status(400).json({ error: 'FaucetPay Error: ' + fpErr.message });
        }
      }
    }

    user.balance -= withdrawAmount;
    user.history.unshift({
      refId,
      type: 'Withdraw',
      detail: `${normalizedMethod.toUpperCase()} (${address.trim()})`,
      amount: -withdrawAmount,
      status: historyStatus
    });
    await user.save();

    await Withdrawal.create({
      refId,
      userId: user._id,
      username: user.username,
      method: normalizedMethod,
      destination: address.trim(),
      network: (network || '').trim(),
      amount: withdrawAmount,
      status: payoutStatus
    });

    res.json({
      message: payoutStatus === 'approved'
        ? `Success! ${withdrawAmount} PEPE has been sent to your FaucetPay wallet.`
        : `Success! Your withdrawal request (${withdrawAmount} PEPE) has been submitted.`,
      balance: user.balance
    });
  } catch (err) {
    res.status(500).json({ error: 'Withdrawal failed: ' + err.message });
  }
});

// --- Admin APIs ---
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (String(pin || '') === String(ADMIN_PIN)) {
    return res.json({ ok: true, message: 'Admin unlocked' });
  }
  return res.status(401).json({ ok: false, message: 'Invalid Admin PIN' });
});

app.get('/api/admin/state', requireAdminPin, async (req, res) => {
  try {
    const [settings, ads, tasks, users, withdrawals, coupons, deposits] = await Promise.all([
      getConfig(),
      Ad.find().sort({ createdAt: -1 }),
      Task.find().sort({ createdAt: -1 }),
      User.find().sort({ createdAt: -1 }),
      Withdrawal.find().sort({ createdAt: -1 }),
      Coupon.find().sort({ createdAt: -1 }),
      Deposit.find().sort({ createdAt: -1 })
    ]);

    const activeUsersCount = users.filter(u => u.status !== 'blocked').length;
    const totalPepeWithdrawn = withdrawals
      .filter(w => w.status === 'approved')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    res.json({
      ok: true,
      stats: {
        activeUsersCount,
        totalPepeWithdrawn,
        totalAdsCount: ads.length,
        totalTasksCount: tasks.length
      },
      settings,
      ads,
      tasks,
      users,
      withdrawals,
      coupons,
      deposits
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.put('/api/admin/settings', requireAdminPin, async (req, res) => {
  try {
    const {
      faucetpay,
      binance,
      referral,
      security,
      adReward,
      dailyAdLimit,
      minWithdraw,
      signUpBonus,
      dailyBonusPepe,
      ptcAdCreateCost,
      couponChannelLink
    } = req.body;

    const updateDoc = {};
    if (faucetpay) updateDoc.faucetpay = faucetpay;
    if (binance) updateDoc.binance = binance;
    if (referral) updateDoc.referral = referral;
    if (security) updateDoc.security = security;
    if (adReward !== undefined) updateDoc.adReward = Number(adReward);
    if (dailyAdLimit !== undefined) updateDoc.dailyAdLimit = Number(dailyAdLimit);
    if (minWithdraw !== undefined) updateDoc.minWithdraw = Number(minWithdraw);
    if (signUpBonus !== undefined) updateDoc.signUpBonus = Number(signUpBonus);
    if (dailyBonusPepe !== undefined) updateDoc.dailyBonusPepe = Number(dailyBonusPepe);
    if (ptcAdCreateCost !== undefined) updateDoc.ptcAdCreateCost = Number(ptcAdCreateCost);
    if (couponChannelLink !== undefined) updateDoc.couponChannelLink = String(couponChannelLink || '').trim();

    const updated = await Settings.findOneAndUpdate(
      { key: 'global_config' },
      { $set: updateDoc },
      { new: true, upsert: true }
    );
    res.json({ ok: true, settings: updated });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/coupons', requireAdminPin, async (req, res) => {
  try {
    const { code, channelLink, rewardPepe, maxUses } = req.body;
    const cleanLink = String(channelLink || '').trim();
    const coupon = await Coupon.create({
      code: String(code || '').trim().toUpperCase(),
      channelLink: cleanLink,
      rewardPepe: Number(rewardPepe) || 100,
      maxUses: Number(maxUses) || 100,
      active: true
    });
    if (cleanLink) {
      await Settings.findOneAndUpdate(
        { key: 'global_config' },
        { $set: { couponChannelLink: cleanLink } },
        { upsert: true }
      );
    }
    res.json({ ok: true, coupon });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.delete('/api/admin/coupons/:id', requireAdminPin, async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.patch('/api/admin/deposits/:id/decision', requireAdminPin, async (req, res) => {
  try {
    const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ ok: false, message: 'Deposit not found' });
    if (deposit.status !== 'pending') {
      return res.status(400).json({ ok: false, message: 'Deposit already processed' });
    }

    deposit.status = decision;
    await deposit.save();

    const user = deposit.userId
      ? await User.findById(deposit.userId)
      : await User.findOne({ username: new RegExp('^' + String(deposit.username || '').trim() + '$', 'i') });

    if (user) {
      if (decision === 'approved') {
        user.depositBalance = Number(user.depositBalance || 0) + Number(deposit.amount || 0);
      }
      const histItem = deposit.refId ? user.history.find(h => h.refId === deposit.refId) : null;
      if (histItem) {
        histItem.status = decision === 'approved' ? 'Approved (Credited)' : 'Rejected';
      }
      user.markModified('history');
      await user.save();
    }

    res.json({ ok: true, deposit });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/ads', requireAdminPin, async (req, res) => {
  try {
    const { title, url, durationSec, rewardPepe } = req.body;
    const ad = await Ad.create({
      title,
      url,
      durationSec: Number(durationSec) || 15,
      rewardPepe: Number(rewardPepe) || 100
    });
    res.json({ ok: true, ad });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.delete('/api/admin/ads/:id', requireAdminPin, async (req, res) => {
  try {
    await Ad.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/tasks', requireAdminPin, async (req, res) => {
  try {
    const { platform, title, link, rewardPepe } = req.body;
    const task = await Task.create({
      platform: platform || 'Telegram',
      title,
      link,
      rewardPepe: Number(rewardPepe) || 250
    });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.delete('/api/admin/tasks/:id', requireAdminPin, async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/users', requireAdminPin, async (req, res) => {
  try {
    const { username, email, password, balance, deviceId, ipAddress } = req.body;
    const cfg = await getConfig();

    if (cfg?.security?.oneAccountPerDevice && deviceId) {
      const devExists = await User.findOne({ deviceId: String(deviceId).trim() });
      if (devExists) {
        return res.status(400).json({ ok: false, message: 'এই Device ID দিয়ে ইতিমধ্যে একটি একাউন্ট আছে!' });
      }
    }
    if (cfg?.security?.oneAccountPerIp && ipAddress) {
      const ipExists = await User.findOne({ ipAddress: String(ipAddress).trim() });
      if (ipExists) {
        return res.status(400).json({ ok: false, message: 'এই IP / Wi-Fi দিয়ে ইতিমধ্যে একটি একাউন্ট আছে!' });
      }
    }

    const cleanUser = String(username || '').trim();
    const cleanEmail = (email || `${cleanUser.toLowerCase()}@pepeearn.local`).trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password || 'PepePass123!', 10);
    const referralCode = cleanUser.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(100 + Math.random() * 900);
    const bal = Number(balance) || 0;

    const user = await User.create({
      username: cleanUser,
      email: cleanEmail,
      password: hashedPassword,
      balance: bal,
      deviceId: (deviceId || '').trim(),
      ipAddress: (ipAddress || '').trim(),
      referralCode,
      history: bal > 0 ? [{ type: 'Admin', detail: 'Initial Admin Balance', amount: bal, status: 'Completed' }] : []
    });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

app.patch('/api/admin/users/:id/balance', requireAdminPin, async (req, res) => {
  try {
    const delta = Number(req.body.delta) || 0;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'ইউজার পাওয়া যায়নি' });

    user.balance = Math.max(0, Number(user.balance || 0) + delta);
    user.history.unshift({
      type: 'Admin',
      detail: 'Balance Adjustment',
      amount: delta,
      status: 'Completed'
    });
    await user.save();
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.patch('/api/admin/users/:id/status', requireAdminPin, async (req, res) => {
  try {
    const status = req.body.status === 'blocked' ? 'blocked' : 'active';
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAdminPin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/admin/withdrawals', requireAdminPin, async (req, res) => {
  try {
    const { username, method, destination, network, amount } = req.body;
    const normalizedMethod = String(method || '').toLowerCase() === 'faucetpay' ? 'faucetpay' : 'binance';
    const cleanUser = String(username || '').trim();
    const numAmount = Number(amount) || 0;
    const refId = 'wd_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);

    const matchedUser = await User.findOne({ username: new RegExp('^' + cleanUser + '$', 'i') });
    let status = 'pending';

    if (normalizedMethod === 'faucetpay') {
      const cfg = await getConfig();
      const fpKey = (cfg?.faucetpay?.apiKey || ENV_FAUCETPAY_API_KEY || '').trim();
      if (cfg?.faucetpay?.enabled && fpKey) {
        await sendFaucetPayExactPepe(fpKey, destination.trim(), numAmount, cfg?.faucetpay?.rateMultiplier || 1);
        status = 'approved';
      }
    }

    if (matchedUser) {
      matchedUser.history.unshift({
        refId,
        type: 'Withdraw',
        detail: `${normalizedMethod.toUpperCase()} (${destination.trim()})`,
        amount: -numAmount,
        status: status === 'approved' ? 'Confirmed (Paid)' : 'Pending'
      });
      await matchedUser.save();
    }

    const withdrawal = await Withdrawal.create({
      refId,
      userId: matchedUser ? matchedUser._id : undefined,
      username: cleanUser,
      method: normalizedMethod,
      destination: String(destination || '').trim(),
      network: String(network || '').trim(),
      amount: numAmount,
      status
    });
    res.json({ ok: true, withdrawal });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// --- অ্যাডমিন Approve / Reject করলে ইউজার প্যানেলের History-ও সাথে সাথে আপডেট হবে ---
app.patch('/api/admin/withdrawals/:id/decision', requireAdminPin, async (req, res) => {
  try {
    const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ ok: false, message: 'রিকোয়েস্ট পাওয়া যায়নি' });

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ ok: false, message: 'এই রিকোয়েস্ট ইতিমধ্যে প্রসেস করা হয়েছে' });
    }

    const cfg = await getConfig();
    let finalUserHistoryStatus = decision === 'approved' ? 'Confirmed (Approved)' : 'Rejected (Refunded)';

    if (decision === 'approved' && withdrawal.method === 'faucetpay') {
      const fpKey = (cfg?.faucetpay?.apiKey || ENV_FAUCETPAY_API_KEY || '').trim();
      await sendFaucetPayExactPepe(fpKey, withdrawal.destination, withdrawal.amount, cfg?.faucetpay?.rateMultiplier || 1);
      finalUserHistoryStatus = 'Confirmed (Paid via FaucetPay)';
    }

    withdrawal.status = decision;
    await withdrawal.save();

    // userId অথবা username দিয়ে ইউজার খুঁজে বের করে তার History আপডেট করা
    let user = null;
    if (withdrawal.userId) {
      user = await User.findById(withdrawal.userId);
    }
    if (!user && withdrawal.username) {
      user = await User.findOne({ username: new RegExp('^' + withdrawal.username.trim() + '$', 'i') });
    }

    if (user) {
      if (decision === 'rejected') {
        user.balance += Number(withdrawal.amount) || 0;
      }

      // প্রথমে refId দিয়ে মিলানো, না পেলে Pending স্ট্যাটাসের ম্যাচিং এন্ট্রি আপডেট করা
      let histItem = withdrawal.refId
        ? user.history.find(h => h.refId === withdrawal.refId)
        : null;

      if (!histItem) {
        histItem = user.history.find(
          h => h.type === 'Withdraw'
            && Math.abs(Number(h.amount)) === Number(withdrawal.amount)
            && String(h.status || '').toLowerCase().includes('pending')
        );
      }

      if (histItem) {
        histItem.status = finalUserHistoryStatus;
      } else {
        user.history.unshift({
          refId: withdrawal.refId || '',
          type: 'Withdraw',
          detail: `${withdrawal.method.toUpperCase()} (${withdrawal.destination})`,
          amount: decision === 'rejected' ? Number(withdrawal.amount) : -Number(withdrawal.amount),
          status: finalUserHistoryStatus
        });
      }

      user.markModified('history');
      await user.save();
    }

    res.json({ ok: true, withdrawal });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// --- Standalone Admin Route ---
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- User Frontend Fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
