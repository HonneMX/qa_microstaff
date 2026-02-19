// OpenAPI 3.0 spec — загружается из JSON, чтобы избежать ошибок парсера TS в больших объектах
import * as path from "path";
import * as fs from "fs";

const jsonPath = path.join(__dirname, "openapi.json");
export const openApiDocument = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
