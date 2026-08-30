// Validación de formularios en línea (se muestra bajo el campo, nunca
// como una ventana emergente del navegador). Compartida como `common`.
export default {
  required: "Este campo es obligatorio.",
  email: "Ingrese un correo electrónico válido.",
  phone: "Solo se permiten dígitos, espacios, + y -.",
  integer: "Ingrese un número entero.",
  number: "Ingrese un número válido.",
  min: "Debe ser al menos {min}.",
  max: "Debe ser como máximo {max}.",
  maxLength: "Debe tener {max} caracteres o menos.",
  percent: "Ingrese un porcentaje entre 0 y 100.",
  dateWithin: "Debe estar entre {start} y {end}.",
  endAfterStart: "La fecha de fin debe ser posterior a la fecha de inicio.",
  futureDate: "La fecha no puede estar en el futuro.",
  unique: '"{value}" ya está en uso.',
  enrollmentTaken: "El número de matrícula {value} ya está en uso.",
  capacityRoom:
    "El cupo de la sección ({capacity}) supera la capacidad del aula ({roomCapacity}).",
  password: "La contraseña debe tener al menos 6 caracteres.",
};
