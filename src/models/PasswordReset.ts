import { Schema, model } from "mongoose";

/** A pending password-reset OTP. Only the hash is stored; Mongo's TTL index deletes expired rows. */
const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export const PasswordResetModel = model("PasswordReset", passwordResetSchema);
