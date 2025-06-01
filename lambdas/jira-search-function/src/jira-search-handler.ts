import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {APIGatewayEvent, APIGatewayProxyResult, Context} from "aws-lambda";
import {DynamoDBClient, PutItemCommand, QueryCommand} from "@aws-sdk/client-dynamodb";

const logger = new Logger({ serviceName: "JiraSearch" });
const dynamodbClient = new DynamoDBClient();

const jiraTable = process.env.JiraTable;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
};

export class JiraSearchHandler implements LambdaInterface {
    public async handler(
        event: APIGatewayEvent,
        _context: Context
    ): Promise<APIGatewayProxyResult> {

        const body = JSON.parse(event.body);
        const userId = body.userId;
        const jql = body.jql;
        const roomId = body.roomId;

        logger.info("userId " + userId)
        logger.info("Request JQL " + jql)

        const query = await dynamodbClient.send(new QueryCommand({
            TableName: jiraTable,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: {
                ':userId': {
                    S: userId
                },
            },
        }));

        if(query.Count == 0 || !query.Items) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: "Jira needs to be linked"
            }
        }

        const allowedRoom = query.Items[0].roomId.S;

        if(allowedRoom != roomId) {
            return {
                statusCode: 403,
                headers: CORS_HEADERS,
                body: "Not allowed"
            }
        }

        const accessToken = query.Items[0].accessToken.S;
        const cloudId = query.Items[0].cloudId.S;
        const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?jql=${jql}`

        const result = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": "Bearer " + accessToken
            }
        })

        if(result.ok) {
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: await result.text()
            }
        }

        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: "Unable to fetch items from Jira"
        }
    }
}

const handlerClass = new JiraSearchHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
