import { Router } from 'express';
import mongoose from 'mongoose';
import Transcription from '../models/Transcription.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  next();
}

// READ (list + search + pagination)
router.get(
  '/',
  wrap(async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const q = (req.query.q || '').trim();
    const filter = q
      ? { $or: [{ text: new RegExp(escapeRegex(q), 'i') }, { title: new RegExp(escapeRegex(q), 'i') }] }
      : {};
    const [items, total] = await Promise.all([
      Transcription.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Transcription.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

// READ (one)
router.get(
  '/:id',
  validId,
  wrap(async (req, res) => {
    const doc = await Transcription.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

// CREATE
router.post(
  '/',
  wrap(async (req, res) => {
    const { title, text, durationSec, source } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });
    const doc = await Transcription.create({ title, text, durationSec, source });
    res.status(201).json(doc);
  })
);

// UPDATE
router.put(
  '/:id',
  validId,
  wrap(async (req, res) => {
    const { title, text } = req.body;
    if (text !== undefined && !String(text).trim()) {
      return res.status(400).json({ error: 'text cannot be empty' });
    }
    const update = {};
    if (title !== undefined) update.title = title;
    if (text !== undefined) update.text = text;
    const doc = await Transcription.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

// DELETE
router.delete(
  '/:id',
  validId,
  wrap(async (req, res) => {
    const doc = await Transcription.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  })
);

export default router;
