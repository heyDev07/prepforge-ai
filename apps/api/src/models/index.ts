/**
 * MongoDB models. Kit content (the InternalKit and research bundle) is stored as validated
 * documents inside the kit record; everything that is queried has an index.
 */
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

// ---------------------------------------------------------------------------------------
// users and sessions

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

const sessionSchema = new Schema(
  {
    /** sha256 of the opaque token in the cookie — the raw token is never stored. */
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------------------
// kits

const kitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fingerprint: { type: String, required: true },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true },
    },
    status: {
      type: String,
      enum: ['draft', 'generating', 'ready', 'ready_with_gaps', 'failed'],
      default: 'draft',
    },
    /** InternalKit (validated with Zod before every write). */
    kit: { type: Schema.Types.Mixed, default: null },
    /** ResearchBundle from the last generation. */
    research: { type: Schema.Types.Mixed, default: null },
    notes: { type: [String], default: [] },
    warnings: { type: [{ code: String, message: String, _id: false }], default: [] },
    /** Incremented on every write; used for optimistic concurrency. */
    revision: { type: Number, default: 0 },
    lastJobId: { type: Schema.Types.ObjectId, ref: 'GenerationJob', default: null },
  },
  { timestamps: true, minimize: false },
);
kitSchema.index({ userId: 1, createdAt: -1 });
kitSchema.index({ userId: 1, fingerprint: 1 });

// ---------------------------------------------------------------------------------------
// generation jobs

const stageLogSchema = new Schema(
  {
    stage: String,
    status: String,
    started_at: String,
    ended_at: { type: String, default: null },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const jobSchema = new Schema(
  {
    kitId: { type: Schema.Types.ObjectId, ref: 'Kit', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['generate', 'regenerate_company', 'regenerate_questions'],
      required: true,
    },
    category: { type: String, default: null },
    /** Extra options for the job, e.g. { force: true } for a brief regeneration. */
    options: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    currentStage: { type: String, default: null },
    progress: { type: Number, default: 0 },
    stageLog: { type: [stageLogSchema], default: [] },
    error: { type: Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
jobSchema.index({ kitId: 1, createdAt: -1 });
jobSchema.index({ status: 1 });

// ---------------------------------------------------------------------------------------
// practice

const attemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kitId: { type: Schema.Types.ObjectId, ref: 'Kit', required: true },
    flashcardId: { type: String, required: true },
    confidence: { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
attemptSchema.index({ kitId: 1, userId: 1, createdAt: 1 });

// ---------------------------------------------------------------------------------------
// shared research cache (public data only — never kits)

const cacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
});
cacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Kit = mongoose.model('Kit', kitSchema);
export const GenerationJobModel = mongoose.model('GenerationJob', jobSchema);
export const PracticeAttempt = mongoose.model('PracticeAttempt', attemptSchema);
export const CacheEntry = mongoose.model('CacheEntry', cacheSchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId; createdAt: Date };
export type KitDoc = Omit<InferSchemaType<typeof kitSchema>, 'input'> & {
  input: { jd: string; company_url: string; days: number };
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type JobDoc = InferSchemaType<typeof jobSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
