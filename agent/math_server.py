import os
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio
from sample_agent import create_agent, ChatState, Message
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI(title="MCP Agent Server")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the agent graph
logger.info("Creating agent graph...")
agent_graph = create_agent()
logger.info("Agent graph created successfully")

@app.get("/")
async def root():
    return {"status": "ok", "message": "MCP Agent Server is running"}

@app.websocket("/chat")
async def chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("New WebSocket connection accepted")
    
    state = ChatState()
    
    try:
        while True:
            # Receive message from client with timeout
            try:
                logger.info("Waiting for client message...")
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                logger.info(f"Received message: {message}")
                
                # Add message to state using Message model
                state.messages.append(Message(role="user", content=message["content"]))
                logger.info(f"Added message to state: {state.messages[-1]}")
                
                # Run the agent
                logger.info("Running agent...")
                try:
                    result = agent_graph.invoke(state)
                    logger.info("Agent run completed successfully")
                    
                    # Convert result back to ChatState if needed
                    new_state = result if isinstance(result, ChatState) else ChatState(**result)
                    
                    # If tool input is prepared, send it to client
                    if hasattr(new_state, 'tool_input') and new_state.tool_input:
                        logger.info(f"Calling tool: {new_state.tool_input}")
                        await websocket.send_json({
                            "type": "tool_call",
                            "data": new_state.tool_input
                        })
                        
                        # Wait for tool result with timeout
                        logger.info("Waiting for tool result...")
                        tool_result = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                        logger.info(f"Tool result received: {tool_result}")
                        new_state.tool_output = tool_result
                    
                    # Send final response
                    logger.info("Sending response...")
                    if hasattr(new_state, 'messages') and new_state.messages:
                        last_message = new_state.messages[-1]
                        response_data = {
                            "type": "message",
                            "data": {"role": last_message.role, "content": last_message.content}
                        }
                        logger.info(f"Response data: {response_data}")
                        await websocket.send_json(response_data)
                        logger.info("Response sent successfully")
                    else:
                        logger.warning("No messages in state to send")
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": "No response generated"}
                        })
                    
                    # Update state
                    state = new_state
                    
                except Exception as e:
                    logger.error(f"Error during agent run: {e}")
                    raise
            
            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for client")
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": "Request timed out"}
                })
                continue
            
    except Exception as e:
        logger.error(f"Error in WebSocket handler: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "data": {"message": str(e)}
            })
        except:
            logger.error("Failed to send error message to client", exc_info=True)
        finally:
            await websocket.close()

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server...")
    uvicorn.run(app, host="0.0.0.0", port=3001, log_level="info") 