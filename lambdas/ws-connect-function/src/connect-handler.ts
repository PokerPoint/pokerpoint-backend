import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {APIGatewayEvent} from "aws-lambda";
import {Logger} from "@aws-lambda-powertools/logger";

const logger = new Logger();

export class ConnectHandler implements LambdaInterface {
    public async handler(event: APIGatewayEvent): Promise<{ statusCode: number }> {
        const connectionId = event.requestContext.connectionId;
        logger.info("Connection ID " + connectionId)

        return { statusCode: 200 }
    }
}

const handlerClass = new ConnectHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
