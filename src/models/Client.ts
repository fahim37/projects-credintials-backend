import { Schema, model } from "mongoose";

export const clientKey = (name: string) => name.trim().toLowerCase();

const clientSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  key: { type: String, required: true, unique: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

clientSchema.pre("validate", function () {
  if (this.name) this.key = clientKey(this.name);
});

export const ClientModel = model("Client", clientSchema);

export function serializeClient(client: { _id: unknown; name: string; createdAt?: Date }, projectCount = 0) {
  return { id: String(client._id), name: client.name, projectCount, createdAt: client.createdAt };
}
