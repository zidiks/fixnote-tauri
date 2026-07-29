import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ROUTE = "fixnote:is-public";
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_ROUTE, true);

