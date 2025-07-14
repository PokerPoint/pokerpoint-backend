import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {
    DeleteItemCommand,
    DynamoDBClient,
    PutItemCommand,
    QueryCommand,
    UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import {APIGatewayEvent} from "aws-lambda";
import * as AWS from 'aws-sdk';

const logger = new Logger();
const dynamodbClient = new DynamoDBClient();

const connectionsTable = process.env.ConnectionTable;
const roomTable = process.env.RoomTable;
const voteTable = process.env.VoteTable;
const jiraTable = process.env.JiraTable;

const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.ApiId + ".execute-api." + process.env.AWS_REGION + ".amazonaws.com/production"
});

export class DefaultHandler implements LambdaInterface {
    public async handler(event: APIGatewayEvent): Promise<{ statusCode: number }> {
        logger.info("Entry handler")
        try {
            const connectionId = event.requestContext.connectionId;
            const body = JSON.parse(event.body);
            const action = body.action;
            const roomId = body.roomId;
            const connections = await getRoomConnections(roomId);

            logger.info("Request received", connectionId, body)

            switch (action) {
                case 'join':
                    if(!await isUserInRoom(roomId, connectionId)) {
                        await handleUserJoin(body.displayName, roomId, connectionId, body.userId);
                    } else {
                        logger.info(connectionId + " is already in the room");
                    }
                    break;
                case 'card':
                    if(await isUserInRoom(roomId, connectionId)) {
                        await handleSetCard(roomId, connections, body.name);
                    } else {
                        logger.info(connectionId + " is not part of room " + roomId);
                    }
                    break;
                case 'vote':
                    if(await isUserInRoom(roomId, connectionId)) {
                        await handleVote(body.vote, connections, roomId, connectionId, body.userId);
                    } else {
                        logger.info(connectionId + " is not part of room " + roomId);
                    }
                    break;
                case 'show':
                    if(await isUserInRoom(roomId, connectionId)) {
                        await showVotes(roomId, connections);
                    } else {
                        logger.info(connectionId + " is not part of room " + roomId);
                    }
                    break;
                case 'jira':
                    if(await isUserInRoom(roomId, connectionId)) {
                        await jira(roomId, connections, body.jql, body.userId);
                    } else {
                        logger.info(connectionId + " is not part of room " + roomId);
                    }
                    break;
                case 'heartbeat':
                    break;
                default:
                    logger.error("Unknown event " + action);
            }

            return { statusCode: 200 }
        } catch (error: unknown) {
            if(error instanceof Error) {
                logger.error("Handler failed: " + error.message);
            }
            return { statusCode: 500 }
        }
    }
}


async function jira(roomId, connections, jql, userId) {
    logger.info("Entry jira, roomId=" + roomId + " jql=" + jql + ", userId=" + userId)
    const query = await dynamodbClient.send(new QueryCommand({
        TableName: jiraTable,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
            ':userId': {
                S: userId
            },
        },
    }));
    if(query.Count > 0) {
        const allowedRoom = query.Items[0].roomId.S;
        const accessToken = query.Items[0].accessToken.S;
        const cloudId = query.Items[0].cloudId.S;
        const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?jql=${jql}`

        if (allowedRoom == roomId) {
            const result = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": "Bearer " + accessToken
                }
            })

            const json = await result.json();

            const simplifiedItems = json.issues?.map(issue => ({
                key: issue.key,
                summary: issue.fields.summary
            })) || [];

            await broadcast("jira", {
                items: simplifiedItems
            }, connections);

        } else {
            logger.info("Not allowed in this room")
        }
    } else {
        logger.info("No Jira tokens found")
    }
}

async function getVotedUsers(roomId: string): Promise<string[]> {
    logger.info("Entry getVotedUsers, roomId = " + roomId)
    const votes = await getVotes(roomId);
    logger.info("We have votes...")
    return votes.Items.map((item: any) => item.connectionId.S) ?? [];
}

async function handleSetCard(roomId: string, connections: any, name: string) {
    logger.info("Entry handleSetCard")
    await dynamodbClient.send(new UpdateItemCommand({
        TableName: roomTable,
        Key: {
            roomId: { S: roomId },
        },
        UpdateExpression: "SET ticketName = :name",
        ExpressionAttributeValues: {
            ":name": { S: name },
        },
    }));

    await broadcast("card", {
        name: name
    }, connections);

    await resetVotes(roomId)
}

async function showVotes(roomId: string, connections: any) {
    logger.info("Entry showVotes, roomId=" + roomId)
    const votes = await getVotes(roomId);
    const result = votes.Items.map(item => ({
        userId: item.connectionId.S,
        vote: item.vote.S,
    }));

    await resetVotes(roomId);
    await broadcast("show", result, connections);
}

async function resetVotes(roomId: string) {
    logger.info("Entry resetVotes");

    const queryResult = await dynamodbClient.send(new QueryCommand({
        TableName: voteTable,
        KeyConditionExpression: "roomId = :roomId",
        ExpressionAttributeValues: {
            ":roomId": { S: roomId },
        },
    }));

    if (queryResult.Items) {
        for (const item of queryResult.Items) {
            const connectionId = item.connectionId.S;
            await dynamodbClient.send(new DeleteItemCommand({
                TableName: voteTable,
                Key: {
                    roomId: { S: roomId },
                    connectionId: { S: connectionId },
                },
            }));
        }
    }

    logger.info("Deleted all votes for roomId:", roomId);
}


async function handleVote(vote: string, connections: any, roomId: string, connectionId: string, userId: string) {
    logger.info("Entry handleVote")
    await dynamodbClient.send(new PutItemCommand({
        TableName: voteTable,
        Item: {
            roomId: {
                S: roomId
            },
            connectionId: {
                S: userId
            },
            vote: {
                S: vote
            },
            ttl: {
                N: getTTL()
            }
        }
    }));

    await broadcast("vote", { userId: userId }, connections);
}

async function handleUserJoin(displayName: string, roomId: string, connectionId: string, userId: string) {
    logger.info("Entry handleUserJoin")
    await saveConnection(roomId, connectionId, displayName, userId);

    const rooms = await getRoom(roomId);
    const room = rooms.Items[0]
    const roomName = room.roomName.S;
    const cards = room.cards.L;
    const connections = await getRoomConnections(roomId);

    const participants = connections.map(participant => ({
        userId: participant.userId.S,
        displayName: participant.displayName.S
    })) ?? [];
    const uniqueParticipantsMap = new Map();
    participants.forEach(participant => {
        if (!uniqueParticipantsMap.has(participant.userId)) {
            uniqueParticipantsMap.set(participant.userId, participant);
        }
    });
    const uniqueParticipants = Array.from(uniqueParticipantsMap.values());

    const card = room.ticketName.S;
    const votes = await getVotedUsers(roomId);
    const ownerUUID = room.ownerUUID.S;


    logger.info("Sending state")
    await apiGateway.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({
            event: "state",
            data: {
                roomName: roomName,
                cards: cards.map(item => item.S),
                card: card,
                participants: uniqueParticipants,
                votes: votes,
                ownerUUID: ownerUUID
            }
        })
    }).promise();

    await broadcastUserJoin(roomId, displayName, userId, connections);
}

async function removeUser(roomId: string, connectionId: string) {
    logger.info("Entry removeUser")
    logger.info(`Removing ${connectionId} from room: ${roomId}`);

    await dynamodbClient.send(new DeleteItemCommand({
        TableName: connectionsTable,
        Key: {
            roomId: {
                S: roomId
            },
            connectionId: {
                S: connectionId
            }
        }
    }));
}

async function broadcastUserJoin(roomId: string, displayName: string, userId: string, roomConnections: any) {
    logger.info("Entry broadcastUserJoin")
    for (const connection of roomConnections) {
        const connectionId = connection.connectionId.S;
        try {
            await apiGateway.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    event: "user-join",
                    data: {
                        displayName: displayName,
                        userId: userId
                    }
                })
            }).promise();
        } catch (err) {
            logger.error("Failed to send message to " + connectionId + ": " + err.message)
            await removeUser(roomId, connectionId);
        }
    }
}

async function broadcast(event: string, data: any, roomConnections: any) {
    logger.info("Entry broadcast")
    for (const connection of roomConnections) {
        const connectionId = connection.connectionId.S;
        try {
            await apiGateway.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    event: event,
                    data: data
                })
            }).promise();
        } catch (err) {
            logger.error("Failed to send message to " + connectionId + ": " + err.message)
        }
    }
}

async function getRoom(roomId: string) {
    logger.info("Entry getRoom")
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

async function getVotes(roomId: string) {
    logger.info("Entry getVotes roomId=" + roomId)
    return await dynamodbClient.send(new QueryCommand({
        TableName: voteTable,
        KeyConditionExpression: "roomId = :roomId",
        ExpressionAttributeValues: {
            ":roomId": {
                S: roomId
            },
        },
    }));
}

async function saveConnection(roomId: string, connectionId: string, displayName: string, userId: string) {
    logger.info("Entry saveConnection")
    await dynamodbClient.send(new PutItemCommand({
        TableName: connectionsTable,
        Item: {
            roomId: {
                S: roomId
            },
            connectionId: {
                S: connectionId
            },
            userId: {
                S: userId
            },
            displayName: {
                S: displayName
            },
            ttl: {
                N: getTTL()
            }
        }
    }));
    logger.info(`${connectionId} joined room ${roomId}`);
}

async function getRoomConnections(roomId: string) {
    logger.info("Entry getRoomConnections")
    await sleep(1000);
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

async function isUserInRoom(roomId: string, connectionId: string) {
    logger.info("Entry isUserInRoom")
    const result = await dynamodbClient.send(new QueryCommand({
        TableName: connectionsTable,
        KeyConditionExpression: "roomId = :roomId AND connectionId = :connectionId",
        ExpressionAttributeValues: {
            ':roomId': {
                S: roomId
            },
            ':connectionId': {
                S: connectionId
            }
        },
    }));
    return result.Count > 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getTTL() {
    return `${Math.floor(Date.now() / 1000) + 28800}`;
}

const handlerClass = new DefaultHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
