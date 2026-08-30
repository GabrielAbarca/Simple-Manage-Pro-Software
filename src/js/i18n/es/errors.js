// Errores de base de datos que llegan al usuario. Dicen qué hacer y nunca
// mencionan una tabla, columna o restricción.
export default {
  db: {
    tooLong: "Ese valor es demasiado largo. Acórtelo e inténtelo de nuevo.",
    missingRequired:
      "Falta un campo obligatorio. Complételo e inténtelo de nuevo.",
    stillReferenced:
      "Este registro todavía se usa en otro lugar, así que no se puede eliminar. Primero elimina o reasigna lo que depende de él.",
    duplicate: "Ese valor ya lo usa otro registro.",
    notAllowedValue:
      "Ese valor no se permite aquí. Revíselo e inténtelo de nuevo.",
    notPermitted: "No tiene permiso para hacer este cambio.",
    generic: "No se pudo guardar el cambio. Inténtelo de nuevo.",
  },
};
