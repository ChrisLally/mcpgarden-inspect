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
    
    # Initialize state
    state = ChatState()
    
    try:
        # Initialize with default empty tools - they will be populated by MCP client if available
        state.available_tools = {}
        
        while True:
            # Handle incoming messages
            try:
                logger.info("Waiting for client message...")
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                logger.info(f"Received message: {message}")
                
                # Handle MCP tool registration
                if isinstance(message, dict) and "tools" in message:
                    tools = message["tools"]
                    state.available_tools = {
                        tool["name"]: {
                            "name": tool["name"],
                            "description": tool.get("description", "No description available"),
                            "input_schema": tool.get("input_schema", {"properties": {}})
                        }
                        for tool in tools
                    }
                    logger.info(f"Updated MCP tools: {list(state.available_tools.keys())}")
                    continue
                
                # Handle regular chat messages
                if isinstance(message, dict) and "content" in message:
                    # Add message to state
                    state.messages.append(Message(role="user", content=message["content"]))
                    
                    # Run agent
                    try:
                        logger.info(f"Running agent with message: {message['content']}")
                        result = agent_graph.invoke(state)
                        new_state = result if isinstance(result, ChatState) else ChatState(**result)
                        
                        # Handle tool calls
                        if new_state.tool_input:
                            logger.info(f"Executing tool: {new_state.tool_input}")
                            await websocket.send_json({
                                "type": "tool_call",
                                "data": new_state.tool_input
                            })
                            
                            tool_result = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                            logger.info(f"Tool result: {tool_result}")
                            new_state.tool_output = tool_result
                        
                        # Send response
                        if new_state.messages:
                            last_message = new_state.messages[-1]
                            await websocket.send_json({
                                "type": "message",
                                "data": {"role": last_message.role, "content": last_message.content}
                            })
                        
                        # Update state
                        state = new_state
                        
                    except Exception as e:
                        logger.error(f"Agent error: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": f"Agent error: {str(e)}"}
                        })
                else:
                    logger.warning(f"Received invalid message format: {message}")
            
            except asyncio.TimeoutError:
                logger.warning("Client message timeout")
                continue
            
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "data": {"message": str(e)}
            })
        except:
            pass
        finally:
            await websocket.close()

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server...")
    uvicorn.run(app, host="0.0.0.0", port=3001, log_level="info") 