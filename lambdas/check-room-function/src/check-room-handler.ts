import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {DynamoDBClient, QueryCommand} from "@aws-sdk/client-dynamodb";
import {APIGatewayEvent, APIGatewayProxyResult, Context} from "aws-lambda";

const dynamodbClient = new DynamoDBClient();

const roomTable = process.env.RoomTable;
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
};

export class CheckRoomHandler implements LambdaInterface {
    public async handler(
        event: APIGatewayEvent,
        _context: Context
    ): Promise<APIGatewayProxyResult> {

        const roomId = event.queryStringParameters.roomId;
        const result = await getRoom(roomId);

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                valid: result.Count > 0
            })
        }

    }
}

async function getRoom(roomId: string) {
    return await dynamodbClient.send(new QueryCommand({
        TableName: roomTable,
        KeyConditionExpression: "roomId = :roomId",
        ExpressionAttributeValues: {
            ':roomId': {
                S: roomId
            },
        },
    }));
}

const handlerClass = new CheckRoomHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
