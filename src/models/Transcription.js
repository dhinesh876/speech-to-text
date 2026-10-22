import mongoose from 'mongoose';

const transcriptionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: '' },
    text: { type: String, required: true, trim: true },
    durationSec: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: ['live', 'manual'], default: 'live' },
  },
  { timestamps: true }
);

transcriptionSchema.index({ createdAt: -1 });

export default mongoose.model('Transcription', transcriptionSchema);
