import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {DeleteItemCommand, DynamoDBClient, QueryCommand} from "@aws-sdk/client-dynamodb";
import {APIGatewayEvent} from "aws-lambda";
import * as AWS from 'aws-sdk';

const logger = new Logger();
const dynamodbClient = new DynamoDBClient();
const connectionsTable = process.env.ConnectionTable;

const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.ApiId + ".execute-api." + process.env.AWS_REGION + ".amazonaws.com/production"
});

export class Disconnect implements LambdaInterface {
    public async handler(event: APIGatewayEvent): Promise<{ statusCode: number }> {
        try {
            await sleep(1000);
            const connectionId = event.requestContext.connectionId;
            const query = await dynamodbClient.send(new QueryCommand({
                TableName: connectionsTable,
                IndexName: "connectionId-index",
                KeyConditionExpression: "connectionId = :connectionId",
                ExpressionAttributeValues: {
                    ":connectionId": { S: connectionId }
                }
            }));

            if(query.Count > 0 && query.Items) {
                const item = query.Items[0];
                const roomId = item.roomId.S;
                await dynamodbClient.send(new DeleteItemCommand({
                    TableName: connectionsTable,
                    Key: {
                        roomId: { S: roomId },
                        connectionId: { S: connectionId }
                    }
                }));
                const connections = await getRoomConnections(roomId);
                await broadcastUserDisconnect(connectionId, connections)
            }

            return { statusCode: 200 }
        } catch (error: unknown) {
            if(error instanceof Error) {
                logger.error("An error occurred: " + error.message);
            }
            return { statusCode: 500 }
        }
    }
}

async function getRoomConnections(roomId: string) {
    const result = await dynamodbClient.send(new QueryCommand({
        TableName: connectionsTable,
        IndexName: "roomId-index",
        KeyConditionExpression: "roomId = :roomId",
        ExpressionAttributeValues: {
            ':roomId': {
                S: roomId
            }
        },
    }));
    return result.Items ?? [];
}

async function broadcastUserDisconnect(userId: string, roomConnections: any) {
    for (const connection of roomConnections) {
        const connectionId = connection.connectionId.S;
        try {
            await apiGateway.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    event: "user-disconnect",
                    data: {
                        userId: userId,
                    }
                })
            }).promise();
        } catch (err) {
            logger.error("Failed to send message to " + connectionId + ": " + err.message)
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const handlerClass = new Disconnect();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
