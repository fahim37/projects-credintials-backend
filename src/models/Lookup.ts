import { Schema, model } from "mongoose";

/**
 * Categories ("E-commerce") and profile names ("webdev_pro2_Fiverr") are both simple,
 * admin-managed name lists used to classify projects, so they share one schema shape.
 */
function lookupSchema() {
  const schema = new Schema(
    {
      name: { type: String, required: true, trim: true },
      // Lower-cased copy used for case-insensitive uniqueness.
      key: { type: String, required: true, unique: true },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  );
  schema.pre("validate", function () {
    if (this.name) this.key = this.name.trim().toLowerCase();
  });
  schema.set("toJSON", {
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.key;
      return ret;
    },
  });
  return schema;
}

export const CategoryModel = model("Category", lookupSchema());
export const ProfileNameModel = model("ProfileName", lookupSchema());
