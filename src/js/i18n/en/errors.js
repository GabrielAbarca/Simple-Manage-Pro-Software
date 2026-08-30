// Database failures that reach the user. Deliberately say what to do next
// and never name a table, column or constraint.
export default {
  db: {
    tooLong: "That value is too long. Shorten it and try again.",
    missingRequired: "A required field is missing. Fill it in and try again.",
    stillReferenced:
      "This record is still in use elsewhere, so it can't be deleted. Remove or reassign what depends on it first.",
    duplicate: "That value is already used by another record.",
    notAllowedValue: "That value isn't allowed here. Check it and try again.",
    notPermitted: "You don't have permission to make this change.",
    generic: "That change couldn't be saved. Please try again.",
  },
};
