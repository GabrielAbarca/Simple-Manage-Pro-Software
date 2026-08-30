// Inline form validation (rendered under the field, never as a native
// browser popup). Shared across views like `common`.
export default {
  required: "This field is required.",
  email: "Enter a valid email address.",
  phone: "Only digits, spaces, + and - are allowed.",
  integer: "Enter a whole number.",
  number: "Enter a valid number.",
  min: "Must be at least {min}.",
  max: "Must be at most {max}.",
  maxLength: "Must be {max} characters or fewer.",
  percent: "Enter a percentage between 0 and 100.",
  dateWithin: "Must be within {start} – {end}.",
  endAfterStart: "End date must be after the start date.",
  futureDate: "The date can't be in the future.",
  unique: '"{value}" is already in use.',
  enrollmentTaken: "Enrollment number {value} is already in use.",
  capacityRoom:
    "Section capacity ({capacity}) exceeds the room's capacity ({roomCapacity}).",
  password: "Password must be at least 6 characters.",
};
