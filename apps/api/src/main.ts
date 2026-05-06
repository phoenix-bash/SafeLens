import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: true,
      credentials: true
    },
    bodyParser: false
  });
  app.use(json({ limit: "32mb" }));
  app.use(urlencoded({ extended: true, limit: "32mb" }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port);
}

bootstrap();

