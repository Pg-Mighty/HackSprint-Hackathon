package com.sumukh.socket.controller;

import java.util.Map;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

@Controller
public class RoomEventController {

    private final SimpMessagingTemplate messagingTemplate;

    public RoomEventController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/rooms/{roomId}/line-created")
    public void handleLineCreated(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/line-created", (Object) payload);

    }

    @MessageMapping("/rooms/{roomId}/line-updated")
    public void handleLineUpdated(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/line-updated", (Object) payload);


    }

    @MessageMapping("/rooms/{roomId}/shape-created")
    public void handleShapeCreated(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/shape-created", (Object) payload);


    }

    @MessageMapping("/rooms/{roomId}/shape-updated")
    public void handleShapeUpdated(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/shape-updated", (Object) payload);


    }

    @MessageMapping("/rooms/{roomId}/cursor-updated")
    public void handleCursorUpdated(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/cursor-updated", (Object) payload);


    }

    @MessageMapping("/rooms/{roomId}/cursor-left")
    public void handleCursorLeft(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/cursor-left", (Object) payload);

    }

    @MessageMapping("/rooms/{roomId}/request-state")
    public void handleStateRequest(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/request-state", (Object) payload);

    }

    @MessageMapping("/rooms/{roomId}/state-sync")
    public void handleStateSync(@DestinationVariable String roomId, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/rooms/" + roomId + "/state-sync", (Object) payload);


    }
}
