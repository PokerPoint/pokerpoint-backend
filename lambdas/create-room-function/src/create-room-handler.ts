import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {ConditionalCheckFailedException, DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb";
import { v4 } from 'uuid';
import {APIGatewayEvent, APIGatewayProxyResult, Context} from "aws-lambda";
import {CreateRoomInput} from "./create-room-input";

const logger = new Logger({ serviceName: "CreateRoomFunction" });
const dynamodbClient = new DynamoDBClient();

const ROOM_TABLE_NAME = process.env.RoomTable;
if (!ROOM_TABLE_NAME) {
    throw new Error("Environment variable RoomTable is not defined");
}

const TTL_SECONDS = 28800; // 8 hours TTL
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
};

export class CreateRoomHandler implements LambdaInterface {
    public async handler(
        event: APIGatewayEvent,
        _context: Context
    ): Promise<APIGatewayProxyResult> {
        try {
            let body: any;
            try {
                body = JSON.parse(event.body || "{}");
            } catch (error) {
                logger.error("Invalid JSON in request body", { error });
                return {
                    statusCode: 400,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ error: "Invalid JSON in request body" }),
                };
            }

            const input = this.validateInput(body);
            const roomId = v4();

            logger.info("Creating room", { roomId, roomName: input.roomName });

            const putItemCommand = new PutItemCommand({
                TableName: ROOM_TABLE_NAME,
                Item: {
                    roomId: { S: roomId },
                    roomName: { S: input.roomName },
                    cards: { L: input.cards.map((card) => ({ S: card })) },
                    ticketName: { S: "N/A" },
                    ownerUUID: { S: input.userUUID },
                    ttl: { N: `${Math.floor(Date.now() / 1000) + TTL_SECONDS}` },
                },
                ConditionExpression: "attribute_not_exists(roomId)",
            });

            await dynamodbClient.send(putItemCommand);
            logger.info("Successfully created room", { roomId, roomName: input.roomName });

            return {
                statusCode: 201,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    roomId,
                    cards: input.cards,
                }),
            };
        } catch (error: unknown) {
            if (error instanceof ConditionalCheckFailedException) {
                logger.warn("Room ID already exists", { roomId: (error as any).roomId });
                return {
                    statusCode: 409,
                    headers: CORS_HEADERS,
                    body: JSON.stringify({ error: "Room ID conflict, please try again" }),
                };
            }

            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error("Failed to create room", { error: errorMessage });

            return {
                statusCode: 500,
                headers: CORS_HEADERS,
                body: JSON.stringify({ error: "Internal server error" }),
            };
        }
    }

    private validateInput(body: any): CreateRoomInput {
        if (!body) {
            throw new Error("Request body is missing");
        }
        if (typeof body.roomName !== "string" || !body.roomName.trim()) {
            throw new Error("roomName is required and must be a non-empty string");
        }
        if (!Array.isArray(body.cards) || body.cards.length === 0 || !body.cards.every((card: any) => typeof card === "string")) {
            throw new Error("cards must be a non-empty array of strings");
        }
        if (typeof body.userUUID !== "string" || !body.userUUID.trim()) {
            throw new Error("userUUID is required and must be a non-empty string");
        }
        return {
            roomName: body.roomName.trim(),
            cards: body.cards,
            userUUID: body.userUUID.trim(),
        };
    }
}

const handlerClass = new CreateRoomHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
