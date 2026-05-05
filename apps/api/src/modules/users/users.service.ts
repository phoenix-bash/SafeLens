import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { email: string; displayName: string }) {
    return this.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName
      }
    });
  }

  getById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId }
    });
  }

  getByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: {
        email: email.toLowerCase()
      }
    });
  }
}
