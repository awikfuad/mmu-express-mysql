export const validateBody = (requiredFields) => {
  return (req, res, next) => {
    const missingFields = [];

    requiredFields.forEach((field) => {
      // Cek apakah field ada di body dan tidak kosong/null/undefined
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        missing_fields: missingFields,
        error: `Field berikut wajib diisi: ${missingFields.join(", ")}`
      });
    }

    next();
  };
};
