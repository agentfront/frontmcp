import { ServerResponse } from '../common';
import { z } from 'zod';

export const RedirectSchema = z.object({
  status: z.literal(302),
  location: z.string().url(),
});
export const NotFoundSchema = z.object({
  status: z.literal(404),
  body: z.any(),
  message: z.string(),
});

type CommonResponseResult = z.infer<typeof RedirectSchema> | z.infer<typeof NotFoundSchema> | any;
export const commonSuccessResponseHandler = (res: ServerResponse, result: CommonResponseResult) => {
  if (result.status === 302) {
    res.redirect(result.location);
  } else {
    if (typeof result.body === 'string') {
      res.setHeader('Content-Type', 'text/plain');
      res.status(result.status).end(result.body);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.status(result.status).json(result.body);
    }
  }
};

export const commonFailResponseHandler = (res: ServerResponse, result: any) => {
  console.log('commonFailResponseHandler', result);
  res.status(500).json('Internal Server Error');
};
